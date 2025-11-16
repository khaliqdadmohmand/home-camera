const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const cors = require('cors');

const app = express();
const server = http.createServer(app);

// Configure Socket.io
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  },
  transports: ['websocket', 'polling']
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Store active streams and peer connections
const activeStreams = new Map();
const peerConnections = new Map();

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    streams: activeStreams.size,
    activeStreams: Array.from(activeStreams.keys())
  });
});

// Socket.io connection handling
io.on('connection', (socket) => {
  console.log('✅ User connected:', socket.id);

  // Streamer creates a stream
  socket.on('create-stream', (streamId) => {
    console.log(`🎥 Creating stream: ${streamId} by ${socket.id}`);
    
    activeStreams.set(streamId, {
      streamer: socket.id,
      viewers: new Set(),
      createdAt: new Date()
    });
    
    socket.join(streamId);
    socket.emit('stream-created', { streamId });
    
    console.log(`📊 Active streams:`, Array.from(activeStreams.keys()));
  });

  // Viewer joins a stream
  socket.on('join-stream', async (streamId) => {
    console.log(`👀 Viewer ${socket.id} trying to join stream: ${streamId}`);
    
    const stream = activeStreams.get(streamId);
    if (stream) {
      stream.viewers.add(socket.id);
      socket.join(streamId);
      
      console.log(`✅ Viewer ${socket.id} joined stream ${streamId}`);
      
      // Notify streamer that a viewer joined
      socket.to(stream.streamer).emit('viewer-joined', {
        viewerId: socket.id,
        viewerCount: stream.viewers.size
      });
      
      // Notify viewer
      socket.emit('stream-joined', { 
        streamId,
        streamerId: stream.streamer
      });

      // Request the streamer to create an offer
      socket.to(stream.streamer).emit('create-offer', {
        viewerId: socket.id,
        streamId: streamId
      });
      
    } else {
      console.log(`❌ Stream not found: ${streamId}`);
      socket.emit('stream-not-found', { streamId });
    }
  });

  // WebRTC signaling - Offer from streamer to viewer
  socket.on('offer', (data) => {
    console.log(`📨 Offer from ${socket.id} to ${data.targetViewerId}`);
    socket.to(data.targetViewerId).emit('offer', {
      offer: data.offer,
      streamId: data.streamId,
      from: socket.id
    });
  });

  // WebRTC signaling - Answer from viewer to streamer
  socket.on('answer', (data) => {
    console.log(`📨 Answer from ${socket.id} to ${data.targetStreamerId}`);
    socket.to(data.targetStreamerId).emit('answer', {
      answer: data.answer,
      streamId: data.streamId,
      from: socket.id
    });
  });

  // WebRTC signaling - ICE candidates
  socket.on('ice-candidate', (data) => {
    console.log(`❄️ ICE candidate from ${socket.id} to ${data.target}`);
    socket.to(data.target).emit('ice-candidate', {
      candidate: data.candidate,
      streamId: data.streamId,
      from: socket.id
    });
  });

  // Handle disconnection
  socket.on('disconnect', (reason) => {
    console.log(`❌ User disconnected: ${socket.id}, reason: ${reason}`);
    
    for (const [streamId, stream] of activeStreams.entries()) {
      if (stream.streamer === socket.id) {
        // Streamer disconnected - end the stream
        socket.to(streamId).emit('stream-ended');
        activeStreams.delete(streamId);
        console.log(`🛑 Stream ${streamId} ended (streamer disconnected)`);
      } else if (stream.viewers.has(socket.id)) {
        // Viewer disconnected
        stream.viewers.delete(socket.id);
        socket.to(stream.streamer).emit('viewer-left', {
          viewerId: socket.id,
          viewerCount: stream.viewers.size
        });
      }
    }
  });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, '0.0.0.0', () => {
  console.log(`
🚀 Camera Streaming Server Started!
📍 Local: http://localhost:${PORT}
🌐 Remote: https://your-app.onrender.com
  `);
});