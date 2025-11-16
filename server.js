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
  transports: ['websocket', 'polling'] // Ensure both transports
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

app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: 'Server is running',
    timestamp: new Date().toISOString(),
    streams: activeStreams.size,
    activeStreams: Array.from(activeStreams.keys())
  });
});

// API to check if stream exists
app.get('/api/stream/:id', (req, res) => {
  const streamId = req.params.id;
  const stream = activeStreams.get(streamId);
  if (stream) {
    res.json({ 
      exists: true, 
      viewers: stream.viewers.size,
      streamer: stream.streamer 
    });
  } else {
    res.json({ exists: false });
  }
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
  socket.on('join-stream', (streamId) => {
    console.log(`👀 Viewer ${socket.id} trying to join stream: ${streamId}`);
    
    const stream = activeStreams.get(streamId);
    if (stream) {
      stream.viewers.add(socket.id);
      socket.join(streamId);
      
      console.log(`✅ Viewer ${socket.id} joined stream ${streamId}`);
      console.log(`👥 Viewers in ${streamId}:`, Array.from(stream.viewers));
      
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
      
    } else {
      console.log(`❌ Stream not found: ${streamId}`);
      socket.emit('stream-not-found', { streamId });
    }
  });

  // WebRTC signaling - Offer from streamer to viewer
  socket.on('offer', (data) => {
    console.log(`📨 Offer from ${socket.id} for stream ${data.streamId}`);
    socket.to(data.streamId).emit('offer', {
      ...data,
      from: socket.id
    });
  });

  // WebRTC signaling - Answer from viewer to streamer
  socket.on('answer', (data) => {
    console.log(`📨 Answer from ${socket.id} for stream ${data.streamId}`);
    socket.to(data.streamId).emit('answer', {
      ...data,
      from: socket.id
    });
  });

  // WebRTC signaling - ICE candidates
  socket.on('ice-candidate', (data) => {
    console.log(`❄️ ICE candidate from ${socket.id} for stream ${data.streamId}`);
    socket.to(data.streamId).emit('ice-candidate', {
      ...data,
      from: socket.id
    });
  });

  // Handle viewer leaving stream
  socket.on('leave-stream', (streamId) => {
    const stream = activeStreams.get(streamId);
    if (stream && stream.viewers.has(socket.id)) {
      stream.viewers.delete(socket.id);
      socket.to(stream.streamer).emit('viewer-left', {
        viewerId: socket.id,
        viewerCount: stream.viewers.size
      });
      console.log(`🚪 Viewer ${socket.id} left stream ${streamId}`);
    }
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
        console.log(`🚪 Viewer ${socket.id} disconnected from ${streamId}`);
      }
    }
  });

  // Error handling
  socket.on('error', (error) => {
    console.error('Socket error:', error);
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({ error: 'Something went wrong!' });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, '0.0.0.0', () => {
  console.log(`
🚀 Camera Streaming Server Started!
📍 Local: http://localhost:${PORT}
🌐 Network: http://YOUR_IP:${PORT}
📊 Health check: http://localhost:${PORT}/health
  `);
});

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down server gracefully...');
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});