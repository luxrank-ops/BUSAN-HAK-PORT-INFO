import express from 'express';
import http from 'http';
import https from 'https';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;

const hjncAgent = new https.Agent({ rejectUnauthorized: false, keepAlive: true, maxSockets: 16 });
const httpKeepAliveAgent = new http.Agent({ keepAlive: true, maxSockets: 16 });

const scheduleMemoryCache = new Map<string, { expiresAt: number; vessels: any[] }>();
const inFlightSchedulePromises = new Map<string, Promise<any[]>>();
const SCHEDULE_CACHE_TTL_MS = 3 * 60 * 1000;

function httpsGetBuffer(url: string, headers: Record<string, string> = {}): Promise<{ statusCode: number; headers: Record<string, any>; body: string }> {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        agent: hjncAgent,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          ...headers
        }
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode || 200,
            headers: res.headers as Record<string, any>,
            body: Buffer.concat(chunks).toString('utf-8')
          });
        });
      }
    );
    req.on('error', reject);
    req.setTimeout(10000, () => {
      req.destroy(new Error('HJNC request timeout'));
    });
  });
}

app.get('/api/hjnc-schedule', async (req, res) => {
  try {
    const targetDate = String(req.query.date || '').trim();
    const startDateParam = String(req.query.startDate || '').trim();
    const endDateParam = String(req.query.endDate || '').trim();

    let startDate = startDateParam;
    let endDate = endDateParam;

    if (!startDate || !endDate) {
      const base = targetDate && /^\d{4}-\d{2}-\d{2}$/.test(targetDate) ? new Date(`${targetDate}T00:00:00`) : new Date();
      const s = new Date(base.getFullYear(), base.getMonth(), base.getDate() - 2);
      const e = new Date(base.getFullYear(), base.getMonth(), base.getDate() + 2);
      const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      startDate = fmt(s);
      endDate = fmt(e);
    }

    const vessels = await fetchTerminalScheduleVessels('hjnc', startDate, endDate);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.json({
      ok: true,
      terminal: 'hjnc',
      startDate,
      endDate,
      total: vessels.length,
      vessels
    });
  } catch (error: any) {
    res.status(500).json({
      ok: false,
      error: error?.message || 'Failed to fetch HJNC schedule'
    });
  }
});

function httpRequestText(
  urlStr: string,
  options: { method?: string; headers?: Record<string, string>; body?: string; encoding?: string } = {}
): Promise<{ statusCode: number; headers: Record<string, any>; body: string }> {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(urlStr);
    const isHttps = parsedUrl.protocol === 'https:';
    const mod = isHttps ? https : http;
    const req = mod.request(
      urlStr,
      {
        method: options.method || 'GET',
        agent: isHttps ? hjncAgent : httpKeepAliveAgent,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          ...(options.headers || {})
        }
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(Buffer.from(c)));
        res.on('end', () => {
          const buf = Buffer.concat(chunks);
          let text = '';
          if (options.encoding === 'euc-kr') {
            try {
              text = new TextDecoder('euc-kr').decode(buf);
            } catch {
              text = buf.toString('utf-8');
            }
          } else {
            text = buf.toString('utf-8');
          }
          resolve({
            statusCode: res.statusCode || 200,
            headers: res.headers as Record<string, any>,
            body: text
          });
        });
      }
    );
    req.on('error', reject);
    req.setTimeout(10000, () => req.destroy(new Error('Terminal schedule request timeout')));
    if (options.body) req.write(options.body);
    req.end();
  });
}

function normalizeDateTimeStr(raw: any): string {
  if (!raw) return '';
  const s = String(raw).trim().replace(/\//g, '-');
  const m = s.match(/(\d{4}-\d{2}-\d{2})(?:\s+(\d{2}:\d{2}))?/);
  if (!m) return '';
  return m[2] ? `${m[1]} ${m[2]}` : m[1];
}

function stripTags(html: string): string {
  return String(html || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function fetchTerminalScheduleVessels(terminalId: string, startDate: string, endDate: string): Promise<any[]> {
  const tid = terminalId.toLowerCase();
  const cacheKey = `${tid}:${startDate}:${endDate}`;
  const now = Date.now();
  const cached = scheduleMemoryCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return cached.vessels;
  }
  const existingPromise = inFlightSchedulePromises.get(cacheKey);
  if (existingPromise) {
    return existingPromise;
  }

  const fetchPromise = fetchTerminalScheduleVesselsUncached(tid, startDate, endDate)
    .then((vessels) => {
      if (Array.isArray(vessels) && vessels.length > 0) {
        scheduleMemoryCache.set(cacheKey, {
          expiresAt: Date.now() + SCHEDULE_CACHE_TTL_MS,
          vessels
        });
      }
      return vessels;
    })
    .finally(() => {
      inFlightSchedulePromises.delete(cacheKey);
    });

  inFlightSchedulePromises.set(cacheKey, fetchPromise);
  return fetchPromise;
}

async function fetchTerminalScheduleVesselsUncached(tid: string, startDate: string, endDate: string): Promise<any[]> {

  if (tid === 'hjnc') {
    const pageRes = await httpsGetBuffer('https://www.hjnc.co.kr/esvc/vessel/berthScheduleT');
    const rawCookies = pageRes.headers['set-cookie'] || [];
    const cookieHeader = Array.isArray(rawCookies)
      ? rawCookies.map((c: string) => c.split(';')[0]).join('; ')
      : String(rawCookies).split(';')[0];

    const query = new URLSearchParams({
      startDate,
      endDate,
      sort: 'ETB',
      dateType: '',
      route: '',
      oper: '',
      amount: '1000',
      page: '1'
    }).toString();

    const dataRes = await httpsGetBuffer(`https://www.hjnc.co.kr/esvc/vessel/berthScheduleT/data?${query}`, {
      Cookie: cookieHeader,
      'X-Requested-With': 'XMLHttpRequest',
      Accept: 'application/json, text/javascript, */*; q=0.01',
      'Content-Type': 'application/json',
      Referer: 'https://www.hjnc.co.kr/esvc/vessel/berthScheduleT'
    });

    const parsed = JSON.parse(dataRes.body || '{}');
    const list = parsed.stringContent ? JSON.parse(parsed.stringContent) : [];
    return (Array.isArray(list) ? list : []).map((v: any) => ({
      TERMINAL: 'HJNC',
      VSL_NM: String(v.VSL_NM || '').trim(),
      BERTH_NO: String(v.BERTH_NO || '').trim(),
      PTNR_CODE: String(v.PTNR_CODE || '').trim(),
      VOY_NO: String(v.VOY_NO || v.OPR_VOY || '').trim(),
      ETB: normalizeDateTimeStr(v.ETB),
      ATA: normalizeDateTimeStr(v.ATA || v.ETB),
      ATW: normalizeDateTimeStr(v.ATW),
      ATC: normalizeDateTimeStr(v.ATC),
      ATD: normalizeDateTimeStr(v.ATD)
    })).filter((v: any) => v.VSL_NM);
  }

  if (tid === 'bnct') {
    const pageRes = await httpRequestText('https://info.bnctkorea.com/esvc/vessel/berthScheduleT');
    const rawCookies = pageRes.headers['set-cookie'] || [];
    const cookieHeader = Array.isArray(rawCookies)
      ? rawCookies.map((c: string) => c.split(';')[0]).join('; ')
      : String(rawCookies).split(';')[0];

    const query = new URLSearchParams({
      VVD: '',
      StrDate: startDate,
      EndDate: endDate
    }).toString();

    const dataRes = await httpRequestText(`https://info.bnctkorea.com/esvc/vessel/berthScheduleT/list?${query}`, {
      headers: {
        Cookie: cookieHeader,
        'X-Requested-With': 'XMLHttpRequest',
        Accept: 'application/json, text/javascript, */*; q=0.01',
        Referer: 'https://info.bnctkorea.com/esvc/vessel/berthScheduleT'
      }
    });

    const list = JSON.parse(dataRes.body || '[]');
    return (Array.isArray(list) ? list : []).map((v: any) => ({
      TERMINAL: 'BNCT',
      VSL_NM: String(v.VSLNAME || '').trim(),
      BERTH_NO: String(v.BERTHNO || '').trim(),
      PTNR_CODE: String(v.OPERATOR || '').trim(),
      VOY_NO: String(v.VVD || '').trim(),
      ETB: normalizeDateTimeStr(v.ETBDATE || v.ATBDATE),
      ATA: normalizeDateTimeStr(v.ATBDATE || v.ETBDATE),
      ATW: normalizeDateTimeStr(v.ATBDATE),
      ATC: normalizeDateTimeStr(v.ATDDATE || v.ETDDATE),
      ATD: normalizeDateTimeStr(v.ATDDATE || v.ETDDATE)
    })).filter((v: any) => v.VSL_NM);
  }

  if (tid === 'dgt') {
    const pageRes = await httpRequestText('https://www.dgtbusan.com/DGT/esvc/vessel/berthScheduleT');
    const rawCookies = pageRes.headers['set-cookie'] || [];
    const cookieHeader = Array.isArray(rawCookies)
      ? rawCookies.map((c: string) => c.split(';')[0]).join('; ')
      : String(rawCookies).split(';')[0];
    const csrfMatch = pageRes.body.match(/name="_csrf"\s+content="([^"]+)"/);
    const csrfToken = csrfMatch ? csrfMatch[1] : '';

    const payload = JSON.stringify({
      fromDate: startDate.replace(/-/g, ''),
      toDate: endDate.replace(/-/g, ''),
      vessel: '',
      voyage: '',
      route: ''
    });

    const dataRes = await httpRequestText('https://www.dgtbusan.com/DGT/esvc/vessel/vesselSchedule', {
      method: 'POST',
      headers: {
        Cookie: cookieHeader,
        'X-CSRF-TOKEN': csrfToken,
        'X-Requested-With': 'XMLHttpRequest',
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Referer: 'https://www.dgtbusan.com/DGT/esvc/vessel/berthScheduleT',
        'Content-Length': String(Buffer.byteLength(payload))
      },
      body: payload
    });

    const parsed = JSON.parse(dataRes.body || '{}');
    const list = parsed.vesselSchedules || [];
    return (Array.isArray(list) ? list : []).map((v: any) => ({
      TERMINAL: 'DGT',
      VSL_NM: String(v.vesselName || '').trim(),
      BERTH_NO: String(v.berthNo || '').trim(),
      PTNR_CODE: String(v.carrier || '').trim(),
      VOY_NO: `${v.vesselCode || ''}-${v.voyageSeq || ''}`,
      ETB: normalizeDateTimeStr(v.etb || v.eta),
      ATA: normalizeDateTimeStr(v.atb || v.ata || v.etb),
      ATW: normalizeDateTimeStr(v.workStartDate),
      ATC: normalizeDateTimeStr(v.workEndDate),
      ATD: normalizeDateTimeStr(v.atd || v.etd)
    })).filter((v: any) => v.VSL_NM);
  }

  if (tid === 'hpnt' || tid === 'pnit') {
    const baseUrl = tid === 'hpnt'
      ? 'https://www.hpnt.co.kr/infoservice/vessel/vslScheduleList.jsp'
      : 'https://www.pnitl.com/infoservice/vessel/vslScheduleList.jsp';
    const originUrl = tid === 'hpnt' ? 'https://www.hpnt.co.kr' : 'https://www.pnitl.com';
    const tmnCod = tid === 'hpnt' ? 'H' : 'P';

    const pageRes = await httpRequestText(baseUrl);
    const rawCookies = pageRes.headers['set-cookie'] || [];
    const cookieHeader = Array.isArray(rawCookies)
      ? rawCookies.map((c: string) => c.split(';')[0]).join('; ')
      : String(rawCookies).split(';')[0];

    const csrfMatch = pageRes.body.match(/CSRF_TOKEN'\s*,\s*value\s*:\s*'([^']+)'/);
    const csrfToken = csrfMatch ? csrfMatch[1] : '';

    const formParams: Record<string, string> = {
      isSearch: 'Y',
      page: '1',
      URI: '',
      userID: '',
      groupID: 'U999',
      tmnCod,
      strdStDate: startDate,
      strdEdDate: endDate,
      route: ''
    };
    if (csrfToken) formParams.CSRF_TOKEN = csrfToken;
    const formBody = new URLSearchParams(formParams).toString();

    let html = pageRes.body;
    try {
      const postRes = await httpRequestText(baseUrl, {
        method: 'POST',
        headers: {
          Cookie: cookieHeader,
          Origin: originUrl,
          'Content-Type': 'application/x-www-form-urlencoded',
          Referer: baseUrl,
          'Content-Length': String(Buffer.byteLength(formBody))
        },
        body: formBody
      });
      if (/class="color_/.test(postRes.body)) {
        html = postRes.body;
      }
    } catch {}
    const rowRegex = /<tr[^>]*class="color_[^"]*"[^>]*>([\s\S]*?)<\/tr>/gi;
    const results: any[] = [];
    let rowMatch;
    while ((rowMatch = rowRegex.exec(html)) !== null) {
      const cells = Array.from(rowMatch[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)).map((m) => stripTags(m[1]));
      if (cells.length >= 10) {
        // HPNT: 0:선석, 1:선사, 2:모선항차, 3:선사항차, 4:선명, 5:ROUTE, 6:반입시작, 7:반입마감, 8:접안일시, 9:출항일시
        // PNIT: 0:선석, 1:선사, 2:모선항차, 3:선사항차, 4:Head/Stern, 5:선명, 6:ROUTE, 7:반입마감, 8:접안일시, 9:출항일시
        const isPnitLayout = /^\d+\s*\(\d+\)/.test(cells[4] || '');
        const vslName = isPnitLayout ? cells[5] : cells[4];
        const etbStr = cells[8] || '';
        const atdStr = cells[9] || '';
        if (vslName) {
          results.push({
            TERMINAL: tid.toUpperCase(),
            VSL_NM: vslName,
            BERTH_NO: cells[0] || '',
            PTNR_CODE: cells[1] || '',
            VOY_NO: cells[2] || '',
            ETB: normalizeDateTimeStr(etbStr),
            ATA: normalizeDateTimeStr(etbStr),
            ATW: normalizeDateTimeStr(etbStr),
            ATC: normalizeDateTimeStr(atdStr),
            ATD: normalizeDateTimeStr(atdStr)
          });
        }
      }
    }
    return results;
  }

  if (tid === 'bptc') {
    const [y1, m1, d1] = startDate.split('-');
    const [y2, m2, d2] = endDate.split('-');
    const formBody = new URLSearchParams({
      v_time: 'term',
      YEAR1: y1,
      MONTH1: m1,
      DAY1: d1,
      YEAR2: y2,
      MONTH2: m2,
      DAY2: d2,
      ROCD: 'ALL',
      v_oper_cd: '',
      ORDER: 'item2',
      v_gu: 'A'
    }).toString();

    const res = await httpRequestText('http://info.bptc.co.kr:9084/Berth_status_text_servlet_sw_kr', {
      method: 'POST',
      encoding: 'euc-kr',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Referer: 'http://info.bptc.co.kr:9084/content/sw/frame/berth_status_text_frame_sw_kr.jsp',
        'Content-Length': String(Buffer.byteLength(formBody))
      },
      body: formBody
    });

    const tbodyMatch = res.body.match(/<tbody>([\s\S]*?)<\/tbody>/i);
    const tbody = tbodyMatch ? tbodyMatch[1] : res.body;
    const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    const results: any[] = [];
    let rowMatch;
    while ((rowMatch = rowRegex.exec(tbody)) !== null) {
      const cells = Array.from(rowMatch[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)).map((m) => stripTags(m[1]));
      // 0:구분(신선대/감만), 1:선석, 2:모선항차, 3:선박명, 4:접안, 5:선사, 6:입항예정, 7:입항일시, 8:작업완료, 9:출항일시
      if (cells.length >= 10 && cells[3]) {
        results.push({
          TERMINAL: 'BPTC',
          VSL_NM: cells[3],
          BERTH_NO: `${cells[0] || ''}${cells[1] || ''}`.trim(),
          PTNR_CODE: cells[5] || '',
          VOY_NO: cells[2] || '',
          ETB: normalizeDateTimeStr(cells[6] || cells[7]),
          ATA: normalizeDateTimeStr(cells[7] || cells[6]),
          ATW: normalizeDateTimeStr(cells[7] || cells[6]),
          ATC: normalizeDateTimeStr(cells[8]),
          ATD: normalizeDateTimeStr(cells[9])
        });
      }
    }
    return results;
  }

  if (tid === 'hbct') {
    const [y1, m1, d1] = startDate.split('-');
    const results: any[] = [];
    const seenKeys = new Set<string>();
    const pagesToFetch = [1, 2, 3];

    const pageBodies = await Promise.all(
      pagesToFetch.map(async (pageNum) => {
        const formBody = new URLSearchParams({
          year: y1,
          month: m1,
          day: d1,
          langType: 'K',
          mainType: 'T01',
          subType: '01',
          optType: 'T',
          terminal: 'HBCTLIB',
          currentPage: String(pageNum),
          startPage: '1'
        }).toString();

        try {
          const res = await httpRequestText('https://custom.hktl.com/jsp/T01/sunsuk.jsp', {
            method: 'POST',
            encoding: 'euc-kr',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              Referer: 'https://custom.hktl.com/jsp/T01/sunsuk.jsp',
              'Content-Length': String(Buffer.byteLength(formBody))
            },
            body: formBody
          });
          return res.body;
        } catch {
          return '';
        }
      })
    );

    for (const body of pageBodies) {
      if (!body) continue;
      const rowRegex = /<tr[^>]*bgcolor="#(?:CCFFFF|FFFFFF|F0F8FF|FFFFCC|CCCCCC|FFFF99)"[^>]*>([\s\S]*?)<\/tr>/gi;
      let rowMatch;
      while ((rowMatch = rowRegex.exec(body)) !== null) {
        const cells = Array.from(rowMatch[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)).map((m) => stripTags(m[1]));
        if (cells.length >= 13 && cells[11] && cells[11] !== '선명') {
          const key = `${cells[0]}_${cells[11]}_${cells[4]}`;
          if (!seenKeys.has(key)) {
            seenKeys.add(key);
            results.push({
              TERMINAL: 'HBCT',
              VSL_NM: cells[11],
              BERTH_NO: cells[2] || '',
              PTNR_CODE: cells[12] || '',
              VOY_NO: cells[0] || '',
              ETB: normalizeDateTimeStr(cells[4]),
              ATA: normalizeDateTimeStr(cells[5] || cells[4]),
              ATW: normalizeDateTimeStr(cells[5] || cells[4]),
              ATC: normalizeDateTimeStr(cells[6]),
              ATD: normalizeDateTimeStr(cells[6])
            });
          }
        }
      }
    }
    return results;
  }

  return [];
}

app.get('/api/terminal-schedule', async (req, res) => {
  try {
    const terminal = String(req.query.terminal || 'hjnc').trim().toLowerCase();
    const targetDate = String(req.query.date || '').trim();
    let startDate = String(req.query.startDate || '').trim();
    let endDate = String(req.query.endDate || '').trim();

    if (!startDate || !endDate) {
      const base = targetDate && /^\d{4}-\d{2}-\d{2}$/.test(targetDate) ? new Date(`${targetDate}T00:00:00`) : new Date();
      const s = new Date(base.getFullYear(), base.getMonth(), base.getDate() - 3);
      const e = new Date(base.getFullYear(), base.getMonth(), base.getDate() + 5);
      const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      startDate = fmt(s);
      endDate = fmt(e);
    }

    const vessels = await fetchTerminalScheduleVessels(terminal, startDate, endDate);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.json({
      ok: true,
      terminal,
      startDate,
      endDate,
      total: vessels.length,
      vessels
    });
  } catch (error: any) {
    res.status(500).json({
      ok: false,
      error: error?.message || 'Failed to fetch terminal schedule'
    });
  }
});

app.use((_, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

app.use('/icons', express.static(path.join(__dirname, 'icons'), { maxAge: '7d' }));
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, filePath) => {
    if (/\.(png|jpg|jpeg|gif|ico|svg|webp)$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
    }
  }
}));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running at http://localhost:${PORT}/`);
  console.log(`Local: http://localhost:${PORT}/`);
  console.log(`Network: http://0.0.0.0:${PORT}/`);
});
