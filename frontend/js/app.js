const socket = io('http://127.0.0.1:5000');
let device, producerTransport, consumerTransport, producer, userId, sessionId, isTeacher;

async function joinSession(event) {
  event.preventDefault();
  const userType = document.getElementById('userType').value;
  const userName = document.getElementById('userName').value.trim();
  const inputSessionId = document.getElementById('sessionId').value.trim();
  const status = document.getElementById('status');

  if (!userName) {
    status.textContent = 'Error: Name is required';
    return;
  }

  isTeacher = userType === 'teacher';
  localStorage.setItem('userName', userName);

  try {
    if (isTeacher) {
      const response = await fetch('http://127.0.0.1:5000/api/create-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ teacherName: userName, sessionName: 'Class Session' })
      });
      const data = await response.json();
      if (!data.success) throw new Error(data.error);
      sessionId = data.sessionId;
      userId = data.userId;
      localStorage.setItem('sessionId', sessionId);
      localStorage.setItem('userId', userId);
      window.location.href = 'teacher.html';
    } else {
      if (!inputSessionId) throw new Error('Session ID required');
      const response = await fetch('http://127.0.0.1:5000/api/join-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: inputSessionId, userName, isTeacher: false })
      });
      const data = await response.json();
      if (!data.success) throw new Error(data.error);
      sessionId = data.sessionId;
      userId = data.userId;
      localStorage.setItem('sessionId', sessionId);
      localStorage.setItem('userId', userId);
      window.location.href = 'student.html';
    }
  } catch (error) {
    status.textContent = `Error: ${error.message}`;
  }
}

async function init() {
  const status = document.getElementById('status');
  userId = localStorage.getItem('userId');
  sessionId = localStorage.getItem('sessionId');

  if (!userId || !sessionId) {
    status.textContent = 'Error: Invalid session. Please join again.';
    window.location.href = 'index.html';
    return;
  }

  isTeacher = window.location.pathname.includes('teacher');
  if (isTeacher) {
    document.getElementById('teacherName').textContent = localStorage.getItem('userName') || 'Teacher';
    document.getElementById('sessionId').textContent = sessionId;
  } else {
    document.getElementById('studentName').textContent = localStorage.getItem('userName') || 'Student';
    document.getElementById('sessionId').textContent = sessionId;
  }

  try {
    socket.emit('join', { sessionId, userId });
    device = new mediasoupClient.Device();
    const rtpCapabilities = await fetch('http://127.0.0.1:3000/router-capabilities')
      .then(res => res.json())
      .then(data => data.rtpCapabilities);
    await device.load({ routerRtpCapabilities: rtpCapabilities });

    if (isTeacher) {
      document.getElementById('startVideo').onclick = () => startStream('video');
      document.getElementById('shareScreen').onclick = () => startStream('screen');
      document.getElementById('stopStream').onclick = stopStream;
      document.getElementById('leaveSession').onclick = leaveSession;
    } else {
      document.getElementById('leaveSession').onclick = leaveSession;
    }

    document.getElementById('qualitySelect').onchange = (e) => {
      if (producer && isTeacher) {
        const quality = e.target.value;
        const maxBitrate = quality === 'low' ? 100000 : quality === 'medium' ? 300000 : 900000;
        producer.setMaxBitrate(maxBitrate);
      }
    };

    socket.on('newProducer', async ({ producerId, kind }) => {
      if (!isTeacher) {
        await consumeStream(producerId, kind);
      }
    });

    socket.on('user_joined', (user) => {
      const li = document.createElement('li');
      li.textContent = `${user.name} (${user.isTeacher ? 'Teacher' : 'Student'})`;
      document.getElementById('participantList').appendChild(li);
    });

    socket.on('user_left', ({ userId }) => {
      const list = document.getElementById('participantList');
      list.querySelectorAll('li').forEach(li => {
        if (li.textContent.includes(userId)) li.remove();
      });
    });

    socket.on('stream_ending', () => {
      if (!isTeacher) {
        document.getElementById('remoteVideo').srcObject = null;
        status.textContent = 'Stream ended';
      }
    });
  } catch (error) {
    status.textContent = `Error: ${error.message}`;
  }
}

async function startStream(type) {
  const status = document.getElementById('status');
  try {
    const constraints = type === 'video' ? { video: true, audio: true } : { video: { mediaSource: 'screen' } };
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    document.getElementById('localVideo').srcObject = stream;

    const response = await fetch('http://127.0.0.1:5000/api/start-stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, userId })
    });
    if (!response.ok) throw new Error('Failed to start stream');

    producerTransport = await createTransport('producer');
    const track = type === 'video' ? stream.getVideoTracks()[0] : stream.getAudioTracks()[0];
    producer = await producerTransport.produce({ track });
    socket.emit('produce', { kind: track.kind, rtpParameters: producer.rtpParameters, sessionId }, ({ id }) => {
      console.log(`Producer ID: ${id}`);
    });
    status.textContent = 'Streaming started';
  } catch (error) {
    status.textContent = `Error: ${error.message}`;
  }
}

async function createTransport(type) {
  const response = await new Promise(resolve => {
    socket.emit(`create${type.charAt(0).toUpperCase() + type.slice(1)}Transport`, resolve);
  });
  const transport = device[type === 'producer' ? 'createSendTransport' : 'createRecvTransport'](response);
  transport.on('connect', ({ dtlsParameters }, callback) => {
    socket.emit(`connect${type.charAt(0).toUpperCase() + type.slice(1)}Transport`, { dtlsParameters }, callback);
  });
  transport.on('produce', ({ kind, rtpParameters }, callback) => {
    socket.emit('produce', { kind, rtpParameters, sessionId }, callback);
  });
  return transport;
}

async function consumeStream(producerId, kind) {
  try {
    consumerTransport = await createTransport('consumer');
    const { id, rtpParameters } = await new Promise(resolve => {
      socket.emit('consume', { producerId, rtpCapabilities: device.rtpCapabilities }, resolve);
    });
    const consumer = await consumerTransport.consume({ id, producerId, kind, rtpParameters });
    const stream = new MediaStream([consumer.track]);
    document.getElementById('remoteVideo').srcObject = stream;
    document.getElementById('status').textContent = 'Stream received';
  } catch (error) {
    document.getElementById('status').textContent = `Error: ${error.message}`;
  }
}

async function stopStream() {
  try {
    if (producer) {
      producer.close();
      producerTransport.close();
      document.getElementById('localVideo').srcObject = null;
      await fetch('http://127.0.0.1:5000/api/end-stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, userId })
      });
      document.getElementById('status').textContent = 'Stream stopped';
    }
  } catch (error) {
    document.getElementById('status').textContent = `Error: ${error.message}`;
  }
}

async function leaveSession() {
  try {
    await fetch('http://127.0.0.1:5000/api/leave-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, userId })
    });
    socket.emit('leave', { sessionId, userId });
    localStorage.clear();
    window.location.href = 'index.html';
  } catch (error) {
    document.getElementById('status').textContent = `Error: ${error.message}`;
  }
}

if (window.location.pathname.includes('index')) {
  document.getElementById('joinForm').onsubmit = joinSession;
} else {
  init();
}