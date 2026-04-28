// ============ 유틸 ============
function vehicleNoToSafeKey(vehicleNo) {
  const utf8 = new TextEncoder().encode(vehicleNo);
  const bin = String.fromCharCode(...utf8);
  return btoa(bin).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function getTripDate(now = new Date()) {
  const d = new Date(now);
  if (d.getHours() < 4) d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

function getCurrentPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('이 브라우저는 GPS 미지원'));
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      (err) => {
        const codes = {
          1: 'GPS 권한이 거부됨. 브라우저 설정에서 위치 허용 후 재시도.',
          2: 'GPS 신호 없음. 실외에서 재시도.',
          3: 'GPS 응답 시간 초과. 재시도.'
        };
        reject(new Error(codes[err.code] || `GPS 오류: ${err.message}`));
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  });
}

async function compressImage(file, maxWidth = 1280, quality = 0.7) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      if (width > maxWidth) { height = height * maxWidth / width; width = maxWidth; }
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('압축 실패')), 'image/jpeg', quality);
    };
    img.onerror = () => reject(new Error('이미지 로드 실패'));
    img.src = URL.createObjectURL(file);
  });
}

// ============ 상태 ============
let currentDriver = null;
let currentTripId = null;
let currentDeliveryId = null;
let currentDeliveryName = null;
let locationWatcherId = null;

function getCurrentDriver() {
  const data = localStorage.getItem('driver');
  return data ? JSON.parse(data) : null;
}

// ============ 초기화 ============
window.addEventListener('DOMContentLoaded', async () => {
  currentDriver = getCurrentDriver();
  if (currentDriver) {
    document.getElementById('login-section').style.display = 'none';
    document.getElementById('app-section').style.display = 'block';
    document.getElementById('display-vehicle').textContent = currentDriver.vehicle_no;
    document.getElementById('display-name').textContent = currentDriver.name;
    await checkOngoingAndUpdateHint();
  }
});

async function checkOngoingAndUpdateHint() {
  const tripDate = getTripDate();
  const { data: ongoing } = await sb.from('trips')
    .select('id, rotation, start_time')
    .eq('vehicle_no', currentDriver.vehicle_no)
    .eq('status', 'ongoing').maybeSingle();

  if (ongoing) {
    currentTripId = ongoing.id;
    document.getElementById('btn-start').style.display = 'none';
    document.getElementById('action-section').style.display = 'block';
    document.getElementById('current-rotation').textContent = ongoing.rotation;
    document.getElementById('start-time-display').textContent = new Date(ongoing.start_time).toLocaleString('ko-KR');
    document.getElementById('rotation-hint').textContent = `🟢 ${ongoing.rotation}회전 운행 중`;
    startLocationTracking(ongoing.id);
    return;
  }

  const { count } = await sb.from('trips')
    .select('id', { count: 'exact', head: true })
    .eq('vehicle_no', currentDriver.vehicle_no)
    .eq('trip_date', tripDate).eq('status', 'completed');
  const next = (count || 0) + 1;
  document.getElementById('rotation-hint').textContent = `오늘 ${count || 0}회전 완료 · 다음 운행은 ${next}회전`;
}

// ============ 등록 ============
async function registerDriver() {
  const vehicle_no = document.getElementById('reg-vehicle').value.trim();
  const name = document.getElementById('reg-name').value.trim();
  const phone = document.getElementById('reg-phone').value.trim();
  if (!vehicle_no || !name || !phone) return alert('모든 정보를 입력해주세요.');

  const storage_key = vehicleNoToSafeKey(vehicle_no);
  try {
    const { error } = await sb.from('drivers').upsert(
      { vehicle_no, name, phone, storage_key },
      { onConflict: 'vehicle_no' }
    );
    if (error) throw error;
    localStorage.setItem('driver', JSON.stringify({ vehicle_no, name, phone, storage_key }));
    location.reload();
  } catch (e) {
    alert('등록 실패: ' + e.message);
  }
}

// ============ 운행 시작 ============
async function startTrip() {
  if (!currentDriver) return alert('차량 정보부터 등록해주세요.');
  const btn = document.getElementById('btn-start');
  btn.disabled = true; btn.textContent = '⏳ GPS 받는 중...';

  try {
    const tripDate = getTripDate();
    const { data: ongoing } = await sb.from('trips').select('id, rotation')
      .eq('vehicle_no', currentDriver.vehicle_no).eq('status', 'ongoing').maybeSingle();
    if (ongoing) throw new Error(`이미 ${ongoing.rotation}회전 운행 중. 종료 후 시작하세요.`);

    const { count } = await sb.from('trips')
      .select('id', { count: 'exact', head: true })
      .eq('vehicle_no', currentDriver.vehicle_no)
      .eq('trip_date', tripDate).eq('status', 'completed');
    const rotation = (count || 0) + 1;
    if (rotation > 3 && !confirm(`오늘 이미 3회전 완료. ${rotation}회전 진행?`)) {
      btn.disabled = false; btn.textContent = '🚚 운행 시작'; return;
    }

    const { lat, lng } = await getCurrentPosition();
    const trip_key = `${currentDriver.vehicle_no}_${tripDate}_${rotation}`;
    const { data, error } = await sb.from('trips').insert({
      trip_key, vehicle_no: currentDriver.vehicle_no, driver_name: currentDriver.name,
      trip_date: tripDate, operation_date: tripDate, rotation,
      status: 'ongoing', start_time: new Date().toISOString(),
      start_lat: lat, start_lng: lng, last_lat: lat, last_lng: lng,
      last_location_at: new Date().toISOString()
    }).select().single();
    if (error) throw error;

    currentTripId = data.id;
    document.getElementById('btn-start').style.display = 'none';
    document.getElementById('action-section').style.display = 'block';
    document.getElementById('current-rotation').textContent = rotation;
    document.getElementById('start-time-display').textContent = new Date().toLocaleString('ko-KR');
    document.getElementById('rotation-hint').textContent = `🟢 ${rotation}회전 운행 시작!`;

    startLocationTracking(data.id);
    alert(`${rotation}회전 운행 시작!`);
  } catch (e) {
    alert('운행 시작 실패: ' + e.message);
    btn.disabled = false; btn.textContent = '🚚 운행 시작';
  }
}

// ============ 위치 추적 ============
function startLocationTracking(tripId) {
  if (locationWatcherId) clearInterval(locationWatcherId);
  locationWatcherId = setInterval(async () => {
    try {
      const { lat, lng } = await getCurrentPosition();
      await sb.from('trip_locations').insert({ trip_id: tripId, lat, lng });
      await sb.from('trips').update({
        last_lat: lat, last_lng: lng, last_location_at: new Date().toISOString()
      }).eq('id', tripId);
    } catch (e) { console.warn('위치 업데이트 실패:', e.message); }
  }, 60000);
}

function stopLocationTracking() {
  if (locationWatcherId) { clearInterval(locationWatcherId); locationWatcherId = null; }
}

// ============ 하차지 ============
async function addDelivery() {
  const place = document.getElementById('delivery-place').value.trim();
  if (!place) return alert('하차지 명칭을 입력하세요.');
  if (!currentTripId) return alert('운행 시작 후 등록 가능합니다.');

  try {
    const { data, error } = await sb.from('deliveries').insert({
      trip_id: currentTripId, destination_name: place
    }).select().single();
    if (error) throw error;
    currentDeliveryId = data.id;
    currentDeliveryName = place;
    document.getElementById('current-delivery-info').textContent = `✅ 현재 하차지: ${place} (이제 사진을 찍으세요)`;
    document.getElementById('delivery-place').value = '';
    alert(`하차지 등록: ${place}`);
  } catch (e) {
    alert('하차지 등록 실패: ' + e.message);
  }
}

// ============ 사진 업로드 ============
async function handleFileUpload(input, category) {
  if (!currentTripId) return alert('운행 시작 후 사진을 올려주세요.');
  if (category === 'delivery' && !currentDeliveryId) return alert('하차지 먼저 등록하세요.');

  const files = Array.from(input.files);
  if (files.length === 0) return;

  let success = 0;
  for (const file of files) {
    try {
      const blob = await compressImage(file);
      const tripDate = getTripDate();
      const rotation = document.getElementById('current-rotation').textContent;
      const safeKey = currentDriver.storage_key || vehicleNoToSafeKey(currentDriver.vehicle_no);
      const filename = `${category}_${Date.now()}_${Math.floor(Math.random() * 1000)}.jpg`;
      const path = `${safeKey}/${tripDate}/${rotation}/${filename}`;

      const { error: upErr } = await sb.storage.from(STORAGE_BUCKET).upload(path, blob, {
        contentType: 'image/jpeg', upsert: false
      });
      if (upErr) throw upErr;

      const { data: urlData } = sb.storage.from(STORAGE_BUCKET).getPublicUrl(path);
      await sb.from('photos').insert({
        trip_id: currentTripId,
        delivery_id: category === 'delivery' ? currentDeliveryId : null,
        category, storage_path: path, public_url: urlData.publicUrl
      });
      success++;
    } catch (e) {
      alert(`${file.name} 업로드 실패: ${e.message}`);
    }
  }

  alert(`${success}/${files.length}장 업로드 완료!`);
  input.value = '';
}

// ============ 운행 종료 ============
async function endTrip() {
  if (!currentTripId) return alert('진행 중인 운행이 없습니다.');
  if (!confirm('정말 운행을 종료하시겠습니까?')) return;

  try {
    stopLocationTracking();
    const { lat, lng } = await getCurrentPosition();
    const { error } = await sb.from('trips').update({
      status: 'completed', end_time: new Date().toISOString(), end_lat: lat, end_lng: lng
    }).eq('id', currentTripId);
    if (error) throw error;
    alert('운행 종료. 수고하셨습니다!');
    location.reload();
  } catch (e) {
    alert('운행 종료 실패: ' + e.message);
  }
}
