// Meta Conversions API (서버사이드 이벤트 전송)
// 브라우저 픽셀과 동일한 event_id를 받아 중복 제거(dedup)하고,
// iOS/광고차단으로 누락되는 전환을 서버에서 보완 전송한다.
//
// 필요 환경변수 (Netlify > Site settings > Environment variables):
//   META_CAPI_TOKEN  = Events Manager에서 발급한 Conversions API 액세스 토큰
//   META_TEST_EVENT_CODE = (선택) 테스트 중일 때만. 검증 끝나면 비워둘 것.

const crypto = require('crypto');

const PIXEL_ID = '1423865953113327';
const API_VERSION = 'v21.0';

// 개인정보는 SHA-256 해시 후 전송 (Meta 요구사항)
function sha256(v) {
  if (!v) return undefined;
  return crypto.createHash('sha256').update(String(v).trim().toLowerCase()).digest('hex');
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const token = process.env.META_CAPI_TOKEN;
  if (!token) {
    return { statusCode: 500, body: JSON.stringify({ error: 'META_CAPI_TOKEN 미설정' }) };
  }

  let p;
  try { p = JSON.parse(event.body || '{}'); }
  catch (e) { return { statusCode: 400, body: 'Bad JSON' }; }

  if (!p.event_name) {
    return { statusCode: 400, body: JSON.stringify({ error: 'event_name 누락' }) };
  }

  const h = event.headers || {};
  const clientIp =
    h['x-nf-client-connection-ip'] ||
    (h['x-forwarded-for'] || '').split(',')[0].trim() ||
    undefined;
  const userAgent = h['user-agent'];

  const userData = {
    client_ip_address: clientIp,
    client_user_agent: userAgent,
    fbp: p.fbp,                 // _fbp 쿠키
    fbc: p.fbc,                 // _fbc 쿠키 (광고 클릭 식별자)
    em: p.em ? sha256(p.em) : undefined,
    ph: p.ph ? sha256(p.ph) : undefined,
  };
  // undefined 값 제거
  Object.keys(userData).forEach((k) => userData[k] === undefined && delete userData[k]);

  const data = [{
    event_name: p.event_name,
    event_time: Math.floor(Date.now() / 1000),
    event_id: p.event_id,                  // ← 브라우저 픽셀과 동일 → 중복 제거
    event_source_url: p.event_source_url,  // ← 실제 페이지 URL (서버가 보장)
    action_source: 'website',
    user_data: userData,
    custom_data: p.custom_data || {},
  }];

  const body = { data };
  if (process.env.META_TEST_EVENT_CODE) {
    body.test_event_code = process.env.META_TEST_EVENT_CODE;
  }

  const url = `https://graph.facebook.com/${API_VERSION}/${PIXEL_ID}/events?access_token=${encodeURIComponent(token)}`;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const out = await res.json();
    return { statusCode: res.ok ? 200 : 502, body: JSON.stringify(out) };
  } catch (e) {
    return { statusCode: 502, body: JSON.stringify({ error: String(e) }) };
  }
};
