// @ts-nocheck
import express from 'express';
import http from 'http';
import https from 'https';
import path from 'path';
import { fileURLToPath } from 'url';


import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';
import cron from 'node-cron';

try {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
    const serviceAccount = JSON.parse(Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_KEY, 'base64').toString('utf-8'));
    initializeApp({ credential: cert(serviceAccount) });
  } else {
    initializeApp();
  }
  console.log('Firebase Admin initialized.');
} catch (e) {
  console.log('Firebase Admin init warning:', e.message);
}

// --- 배차 변경 감지 스케줄러 (매 정각마다 실행) ---
cron.schedule('0 * * * *', async () => {
  console.log('[CRON] 선박 출항 스케줄 변경 감지 시작...', new Date().toISOString());
  try {
    if (getApps().length === 0) {
      console.log('[CRON] Firebase Admin이 초기화되지 않아 스케줄러를 종료합니다.');
      return;
    }
    const firestore = getFirestore();
    
    const base = new Date();
    const s = new Date(base.getFullYear(), base.getMonth(), base.getDate() - 1);
    const e = new Date(base.getFullYear(), base.getMonth(), base.getDate() + 3);
    const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const startDate = fmt(s);
    const endDate = fmt(e);

    const terminals = ['hjnc', 'bnct', 'dgt', 'hpnt', 'pnit', 'bptc', 'hbct'];
    const allVessels = [];
    
    for (const term of terminals) {
      try {
        const vessels = await fetchTerminalScheduleVessels(term, startDate, endDate);
        allVessels.push(...vessels);
      } catch (err) {
        console.error(`[CRON] ${term} 스케줄 조회 실패:`, err.message);
      }
    }
    
    const cacheRef = firestore.collection('vessel_schedules_cache');
    const logsRef = firestore.collection('work_logs');
    
    for (const v of allVessels) {
      if (!v.VSL_NM) continue;
      const vslId = `${v.TERMINAL}_${v.VOY_NO}_${v.VSL_NM.replace(/\s+/g,'_')}`;
      const doc = await cacheRef.doc(vslId).get();
      
      let isChanged = false;
      let oldAtd = null;
      
      if (doc.exists) {
        const data = doc.data();
        oldAtd = data.ATD;
        if (oldAtd && v.ATD && oldAtd !== v.ATD) {
          isChanged = true;
        }
      }
      
      await cacheRef.doc(vslId).set({
        TERMINAL: v.TERMINAL,
        VSL_NM: v.VSL_NM,
        VOY_NO: v.VOY_NO,
        ATD: v.ATD || null,
        updatedAt: FieldValue.serverTimestamp()
      }, { merge: true });
      
      if (isChanged) {
        console.log(`[CRON] 출항시간 변경 감지: ${v.VSL_NM} (${oldAtd} -> ${v.ATD})`);
        
        const snapshot = await logsRef.where('date', '>=', startDate).where('date', '<=', endDate).get();
        const notifiedUsers = new Set();
        
        snapshot.forEach(logDoc => {
          const logData = logDoc.data();
          const savedShipName = (logData.shipName || '').toUpperCase();
          const targetShipName = v.VSL_NM.toUpperCase();
          
          if (savedShipName.includes(targetShipName) && !notifiedUsers.has(logData.workerId)) {
            notifiedUsers.add(logData.workerId);
            
            const notiRef = firestore.collection('notifications').doc();
            const message = `[${v.TERMINAL}] ${v.VSL_NM}호의 출항 시간이 변경되었습니다. (${oldAtd} -> ${v.ATD})`;
            
            notiRef.set({
              userId: logData.workerId,
              title: '출항 시간 변경 안내 🚢',
              body: message,
              type: 'SCHEDULE_CHANGE',
              read: false,
              createdAt: FieldValue.serverTimestamp()
            });
            
            sendPushNotification(logData.workerId, '출항 시간 변경 안내 🚢', message);
          }
        });
      }
    }
    console.log('[CRON] 선박 출항 스케줄 변경 감지 완료');
  } catch (error) {
    console.error('[CRON] 에러 발생:', error);
  }
});

async function sendPushNotification(userId, title, body) {
  try {
    if (getApps().length === 0) return;
    const userDoc = await getFirestore().collection('user_profiles').doc(userId).get();
    if (!userDoc.exists) return;
    
    const token = userDoc.data().fcmToken;
    if (!token) return;
    
    await getMessaging().send({
      token,
      notification: { title, body },
      data: { type: 'SCHEDULE_CHANGE', click_action: 'FLUTTER_NOTIFICATION_CLICK' }
    });
    console.log(`[FCM] ${userId}에게 푸시 발송 완료`);
  } catch (err) {
    console.error(`[FCM] ${userId} 발송 실패:`, err);
  }
}
// --------------------------------------------------------

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running at http://localhost:${PORT}/`);
  console.log(`Local: http://localhost:${PORT}/`);
  console.log(`Network: http://0.0.0.0:${PORT}/`);
});
