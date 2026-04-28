// ⚠️ config.js의 sb를 그대로 사용

// ============ 로그인 ============
function checkPassword() {
  const pw = document.getElementById('admin-pw').value;
  if (pw === ADMIN_PASSWORD) {
    document.getElementById('login-box').style.display = 'none';
    document.getElementById('dashboard').style.display = 'block';
    document.getElementById('filter-date').value = new Date().toISOString().slice(0, 10);
    loadTrips();
  } else {
    document.getElementById('pw-error').style.display = 'block';
  }
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('admin-pw').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') checkPassword();
  });
});

// ============ 탭 전환 ============
function switchTab(name) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  event.target.classList.add('active');
  document.getElementById('tab-list').style.display = name === 'list' ? 'block' : 'none';
  document.getElementById('tab-live').style.display = name === 'live' ? 'block' : 'none';
  if (name === 'live') initLiveMap();
}

// ============ 운행 목록 조회 ============
async function loadTrips() {
  const date = document.getElementById('filter-date').value;
  const vehicle = document.getElementById('filter-vehicle').value.trim();
  const status = document.getElementById('filter-status').value;
  
  let query = sb.from('trips').select('*').order('start_time', { ascending: false });
  if (date) query = query.eq('trip_date', date);
  if (vehicle) query = query.ilike('vehicle_no', `%${vehicle}%`);
  if (status) query = query.eq('status', status);
  
  const { data, error } = await query;
  if (error) return alert('조회 실패: ' + error.message);
  
  const tbody = document.getElementById('trip-body');
  if (!data || data.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; padding:30px;">데이터 없음</td></tr>';
    return;
  }
  
  tbody.innerHTML = data.map(t => {
    const start = t.start_time ? new Date(t.start_time).toLocaleTimeString('ko-KR') : '-';
    const end = t.end_time ? new Date(t.end_time).toLocaleTimeString('ko-KR') : '-';
    const statusBadge = t.status === 'ongoing' 
      ? '<span style="color:#10b981;font-weight:bold;">🟢 운행중</span>'
      : '<span style="color:#6b7280;">✅ 완료</span>';
    return `
      <tr class="trip-row" onclick="toggleDetail(${t.id})" style="cursor:pointer;">
        <td><span class="arrow" id="arrow-${t.id}">▶</span> ${t.trip_date}</td>
        <td><b>${t.vehicle_no}</b></td>
        <td>${t.driver_name || '-'}</td>
        <td>${t.rotation}회전</td>
        <td>${start}</td>
        <td>${end}</td>
        <td>${statusBadge}</td>
        <td><button onclick="event.stopPropagation(); downloadAllPhotos(${t.id});" style="background:#10b981;">📥 ZIP</button></td>
      </tr>
      <tr class="detail-row" id="detail-${t.id}" style="display:none;">
        <td colspan="8" style="background:#f9fafb; padding:0;">
          <div id="detail-content-${t.id}" style="padding:20px;">불러오는 중...</div>
        </td>
      </tr>
    `;
  }).join('');
}

// ============ 운행 상세 펼치기 (아코디언) ============
async function toggleDetail(tripId) {
  const detailRow = document.getElementById(`detail-${tripId}`);
  const arrow = document.getElementById(`arrow-${tripId}`);
  
  if (detailRow.style.display === 'none') {
    detailRow.style.display = 'table-row';
    arrow.textContent = '▼';
    await loadTripDetail(tripId);
  } else {
    detailRow.style.display = 'none';
    arrow.textContent = '▶';
  }
}

async function loadTripDetail(tripId) {
  const container = document.getElementById(`detail-content-${tripId}`);
  
  // 1) 사진 + 하차지 동시 조회
  const [photosRes, deliveriesRes] = await Promise.all([
    sb.from('photos').select('*').eq('trip_id', tripId).order('created_at'),
    sb.from('deliveries').select('*').eq('trip_id', tripId).order('delivered_at')
  ]);
  
  const photos = photosRes.data || [];
  const deliveries = deliveriesRes.data || [];
  
  // 2) 카테고리별로 분류
  const loadingPhotos = photos.filter(p => p.category === 'loading');
  const tachoPhotos = photos.filter(p => p.category === 'tacho');
  const deliveryPhotos = photos.filter(p => p.category === 'delivery');
  
  // 3) HTML 조립
  let html = '';
  
  // 상차/타코메타 섹션
  if (loadingPhotos.length || tachoPhotos.length) {
    html += `<div class="section-block">
      <h3 style="margin-top:0;">📦 상차 정보</h3>
      ${loadingPhotos.length ? renderPhotoGroup('상차 사진', loadingPhotos) : ''}
      ${tachoPhotos.length ? renderPhotoGroup('🌡️ 타코메타 (온도기록지)', tachoPhotos) : ''}
    </div>`;
  }
  
  // 하차지별 섹션
  if (deliveries.length === 0) {
    html += `<div class="section-block"><p style="color:#6b7280;">📍 등록된 하차지가 없습니다.</p></div>`;
  } else {
    html += `<div class="section-block">
      <h3>📍 납품 내역 (${deliveries.length}개소)</h3>`;
    
    deliveries.forEach((d, idx) => {
      const dPhotos = deliveryPhotos.filter(p => p.delivery_id === d.id);
      const arrivedTime = new Date(d.delivered_at).toLocaleString('ko-KR');
      html += `
        <div class="delivery-card">
          <div class="delivery-header">
            <b>📍 하차지 ${idx + 1}: ${d.destination_name}</b>
            <span style="color:#6b7280; font-size:13px; margin-left:10px;">도착: ${arrivedTime}</span>
            <span class="photo-count">사진 ${dPhotos.length}장</span>
          </div>
          ${dPhotos.length 
            ? renderPhotoGrid(dPhotos)
            : '<p style="color:#9ca3af; padding:10px;">⚠️ 등록된 사진이 없습니다.</p>'}
        </div>
      `;
    });
    html += '</div>';
  }
  
  // 하차지에 연결 안된 delivery 사진 (혹시 모를 누락 방지)
  const orphanDeliveryPhotos = deliveryPhotos.filter(p => !p.delivery_id);
  if (orphanDeliveryPhotos.length) {
    html += `<div class="section-block">
      <h3>⚠️ 하차지 미연결 사진</h3>
      ${renderPhotoGrid(orphanDeliveryPhotos)}
    </div>`;
  }
  
  container.innerHTML = html || '<p style="color:#6b7280;">기록된 데이터가 없습니다.</p>';
}

// 사진 그룹 (제목 + 그리드)
function renderPhotoGroup(title, photos) {
  return `
    <div style="margin-bottom:15px;">
      <h4 style="margin:10px 0 8px 0; color:#374151;">${title} (${photos.length}장)</h4>
      ${renderPhotoGrid(photos)}
    </div>
  `;
}

// 사진 그리드 (썸네일)
function renderPhotoGrid(photos) {
  return `
    <div class="photo-grid">
      ${photos.map(p => `
        <a href="${p.public_url}" target="_blank" class="photo-thumb">
          <img src="${p.public_url}" loading="lazy">
          <span class="photo-time">${new Date(p.created_at).toLocaleTimeString('ko-KR')}</span>
        </a>
      `).join('')}
    </div>
  `;
}

// ============ 전체 사진 ZIP 다운로드 ============
async function downloadAllPhotos(tripId) {
  if (!window.JSZip) {
    alert('JSZip 라이브러리가 로드되지 않았습니다.');
    return;
  }
  
  const btn = event.target;
  btn.disabled = true; btn.textContent = '⏳ 준비중...';
  
  try {
    // 운행 정보 + 사진 + 하차지 동시 조회
    const [tripRes, photosRes, deliveriesRes] = await Promise.all([
      sb.from('trips').select('*').eq('id', tripId).single(),
      sb.from('photos').select('*').eq('trip_id', tripId),
      sb.from('deliveries').select('*').eq('trip_id', tripId)
    ]);
    
    const trip = tripRes.data;
    const photos = photosRes.data || [];
    const deliveries = deliveriesRes.data || [];
    
    if (photos.length === 0) {
      alert('다운로드할 사진이 없습니다.');
      return;
    }
    
    const zip = new JSZip();
    const folderName = `${trip.vehicle_no}_${trip.trip_date}_${trip.rotation}회전`;
    const root = zip.folder(folderName);
    
    // 하차지 ID → 폴더명 매핑
    const deliveryFolderMap = {};
    deliveries.forEach((d, idx) => {
      deliveryFolderMap[d.id] = `하차지${idx + 1}_${d.destination_name}`;
    });
    
    btn.textContent = `⏳ 다운로드 0/${photos.length}`;
    
    // 사진 다운로드 + ZIP 추가
    let done = 0;
    await Promise.all(photos.map(async (p) => {
      try {
        const res = await fetch(p.public_url);
        const blob = await res.blob();
        let folderPath;
        if (p.category === 'loading') folderPath = '01_상차';
        else if (p.category === 'tacho') folderPath = '02_타코메타';
        else if (p.category === 'delivery' && p.delivery_id) folderPath = `03_${deliveryFolderMap[p.delivery_id] || '하차지'}`;
        else folderPath = '04_기타';
        
        const filename = p.storage_path.split('/').pop();
        root.folder(folderPath).file(filename, blob);
        done++;
        btn.textContent = `⏳ 다운로드 ${done}/${photos.length}`;
      } catch (e) { console.warn('사진 실패:', p.public_url, e); }
    }));
    
    // 운행 정보 텍스트 파일
    let summary = `운행 정보\n========================\n`;
    summary += `차량: ${trip.vehicle_no}\n기사: ${trip.driver_name}\n날짜: ${trip.trip_date}\n회전: ${trip.rotation}회전\n`;
    summary += `시작: ${new Date(trip.start_time).toLocaleString('ko-KR')}\n`;
    summary += `종료: ${trip.end_time ? new Date(trip.end_time).toLocaleString('ko-KR') : '-'}\n\n`;
    summary += `하차지 목록\n========================\n`;
    deliveries.forEach((d, idx) => {
      summary += `${idx + 1}. ${d.destination_name} (도착: ${new Date(d.delivered_at).toLocaleString('ko-KR')})\n`;
    });
    root.file('운행정보.txt', summary);
    
    btn.textContent = '⏳ 압축 중...';
    const zipBlob = await zip.generateAsync({ type: 'blob' });
    
    const url = URL.createObjectURL(zipBlob);
    const a = document.createElement('a');
    a.href = url; a.download = `${folderName}.zip`;
    a.click(); URL.revokeObjectURL(url);
    
    btn.textContent = '📥 ZIP';
  } catch (e) {
    alert('다운로드 실패: ' + e.message);
    btn.textContent = '📥 ZIP';
  } finally {
    btn.disabled = false;
  }
}

// ============ 실시간 지도 (변경 없음) ============
let liveMap = null;
let liveMarkers = {};
let liveInterval = null;

function initLiveMap() {
  if (liveMap) {
    setTimeout(() => liveMap.invalidateSize(), 100);
    return;
  }
  liveMap = L.map('live-map').setView([37.5665, 126.9780], 11);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap'
  }).addTo(liveMap);
  refreshLiveMarkers();
  liveInterval = setInterval(refreshLiveMarkers, 5000);
}

async function refreshLiveMarkers() {
  const { data: trips } = await sb.from('trips')
    .select('id, vehicle_no, driver_name, rotation, start_time, last_lat, last_lng, last_location_at')
    .eq('status', 'ongoing').not('last_lat', 'is', null);
  const now = Date.now();
  const activeIds = new Set();
  (trips || []).forEach(t => {
    activeIds.add(t.id);
    const min = (now - new Date(t.last_location_at).getTime()) / 60000;
    const color = min > 5 ? '#dc2626' : '#2563eb';
    const popup = `<b>${t.vehicle_no}</b> (${t.driver_name})<br>${t.rotation}회전 · 시작 ${new Date(t.start_time).toLocaleTimeString('ko-KR')}<br>업데이트: ${Math.round(min)}분 전`;
    if (liveMarkers[t.id]) {
      liveMarkers[t.id].setLatLng([t.last_lat, t.last_lng]).getPopup().setContent(popup);
    } else {
      const icon = L.divIcon({
        html: `<div style="background:${color};width:32px;height:32px;border-radius:50%;border:3px solid white;box-shadow:0 0 6px rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;font-size:16px;">🚛</div>`,
        className: '', iconSize: [32, 32]
      });
      liveMarkers[t.id] = L.marker([t.last_lat, t.last_lng], { icon }).addTo(liveMap).bindPopup(popup);
    }
  });
  Object.keys(liveMarkers).forEach(id => {
    if (!activeIds.has(parseInt(id))) {
      liveMap.removeLayer(liveMarkers[id]);
      delete liveMarkers[id];
    }
  });
  document.getElementById('live-count').textContent = trips ? trips.length : 0;
}
