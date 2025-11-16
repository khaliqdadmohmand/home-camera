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
  }
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Store active streams
const activeStreams = new Map();

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    streams: activeStreams.size,
    uptime: process.uptime()
  });
});

// Socket.io connection handling
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // Streamer creates a stream
  socket.on('create-stream', (streamId) => {
    activeStreams.set(streamId, {
      streamer: socket.id,
      viewers: new Set(),
      createdAt: new Date()
    });
    socket.join(streamId);
    console.log(`🎥 Stream created: ${streamId} by ${socket.id}`);
    
    socket.emit('stream-created', { streamId });
  });

  // Viewer joins a stream
  socket.on('join-stream', (streamId) => {
    const stream = activeStreams.get(streamId);
    if (stream) {
      stream.viewers.add(socket.id);
      socket.join(streamId);
      
      // Notify streamer that a viewer joined
      socket.to(stream.streamer).emit('viewer-joined', {
        viewerId: socket.id,
        viewerCount: stream.viewers.size
      });
      
      socket.emit('stream-joined', { streamId });
      console.log(`👀 Viewer ${socket.id} joined stream ${streamId}`);
    } else {
      socket.emit('stream-not-found', { streamId });
    }
  });

  // WebRTC signaling
  socket.on('offer', (data) => {
    socket.to(data.streamId).emit('offer', data);
  });

  socket.on('answer', (data) => {
    socket.to(data.streamId).emit('answer', data);
  });

  socket.on('ice-candidate', (data) => {
    socket.to(data.streamId).emit('ice-candidate', data);
  });

  // Handle viewer leaving
  socket.on('leave-stream', (streamId) => {
    const stream = activeStreams.get(streamId);
    if (stream && stream.viewers.has(socket.id)) {
      stream.viewers.delete(socket.id);
      socket.to(stream.streamer).emit('viewer-left', {
        viewerId: socket.id,
        viewerCount: stream.viewers.size
      });
    }
  });

  // Handle disconnection
  socket.on('disconnect', () => {
    for (const [streamId, stream] of activeStreams.entries()) {
      if (stream.streamer === socket.id) {
        socket.to(streamId).emit('stream-ended');
        activeStreams.delete(streamId);
        console.log(`🛑 Stream ${streamId} ended`);
      } else if (stream.viewers.has(socket.id)) {
        stream.viewers.delete(socket.id);
        socket.to(stream.streamer).emit('viewer-left', {
          viewerId: socket.id,
          viewerCount: stream.viewers.size
        });
      }
    }
    console.log('User disconnected:', socket.id);
  });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, '0.0.0.0', () => {
  console.log(`
🚀 Camera Streaming Server Started!
📍 Local: http://localhost:${PORT}
🌐 Network: http://YOUR_IP:${PORT}
  `);
});