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

// Store active streams in memory (will reset on server restart)
const activeStreams = new Map();

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    streams: activeStreams.size,
    activeStreams: Array.from(activeStreams.keys()).map(id => ({
      id,
      viewers: activeStreams.get(id).viewers.size,
      streamer: activeStreams.get(id).streamer
    }))
  });
});

// API to check if stream exists
app.get('/api/stream/:id', (req, res) => {
  const streamId = req.params.id;
  const stream = activeStreams.get(streamId);
  console.log(`🔍 Checking stream ${streamId}:`, stream ? 'EXISTS' : 'NOT FOUND');
  
  if (stream) {
    res.json({ 
      exists: true, 
      viewers: stream.viewers.size,
      streamer: stream.streamer,
      createdAt: stream.createdAt
    });
  } else {
    res.json({ 
      exists: false,
      message: 'Stream not found or may have ended'
    });
  }
});

// Get all active streams
app.get('/api/streams', (req, res) => {
  const streams = Array.from(activeStreams.entries()).map(([id, stream]) => ({
    id,
    viewers: stream.viewers.size,
    streamer: stream.streamer,
    createdAt: stream.createdAt
  }));
  res.json(streams);
});

// Socket.io connection handling
io.on('connection', (socket) => {
  console.log('✅ User connected:', socket.id, 'Total streams:', activeStreams.size);

  // Send current streams to newly connected client
  socket.emit('active-streams', Array.from(activeStreams.keys()));

  // Streamer creates a stream
  socket.on('create-stream', (streamId) => {
    console.log(`🎥 Creating stream: ${streamId} by ${socket.id}`);
    
    // Check if stream already exists
    if (activeStreams.has(streamId)) {
      console.log(`❌ Stream ${streamId} already exists`);
      socket.emit('stream-exists', { streamId });
      return;
    }
    
    activeStreams.set(streamId, {
      streamer: socket.id,
      viewers: new Set(),
      createdAt: new Date()
    });
    
    socket.join(streamId);
    socket.emit('stream-created', { streamId });
    
    // Broadcast to all clients that a new stream is available
    socket.broadcast.emit('stream-started', { streamId });
    
    console.log(`✅ Stream created: ${streamId}`);
    console.log(`📊 Active streams:`, Array.from(activeStreams.keys()));
  });

  // Viewer joins a stream
  socket.on('join-stream', async (streamId) => {
    console.log(`👀 Viewer ${socket.id} trying to join stream: ${streamId}`);
    console.log(`📊 Available streams:`, Array.from(activeStreams.keys()));
    
    const stream = activeStreams.get(streamId);
    if (stream) {
      // Check if streamer is still connected
      const streamerSocket = io.sockets.sockets.get(stream.streamer);
      if (!streamerSocket) {
        console.log(`❌ Streamer ${stream.streamer} not connected for stream ${streamId}`);
        activeStreams.delete(streamId);
        socket.emit('streamer-disconnected', { streamId });
        return;
      }
      
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

      // Request the streamer to create an offer
      console.log(`📨 Requesting offer from streamer ${stream.streamer}`);
      socket.to(stream.streamer).emit('create-offer', {
        viewerId: socket.id,
        streamId: streamId
      });
      
    } else {
      console.log(`❌ Stream not found: ${streamId}`);
      console.log(`📊 Current streams:`, Array.from(activeStreams.keys()));
      socket.emit('stream-not-found', { 
        streamId,
        availableStreams: Array.from(activeStreams.keys())
      });
    }
  });

  // WebRTC signaling - Offer from streamer to viewer
  socket.on('offer', (data) => {
    console.log(`📨 Offer from ${socket.id} to ${data.targetViewerId}`);
    console.log(`📦 Offer details:`, {
      streamId: data.streamId,
      type: data.offer.type
    });
    
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
        console.log(`🛑 Streamer disconnected, ending stream: ${streamId}`);
        socket.to(streamId).emit('stream-ended', {
          streamId,
          reason: 'Streamer disconnected'
        });
        activeStreams.delete(streamId);
        
        // Broadcast that stream ended
        socket.broadcast.emit('stream-ended-broadcast', { streamId });
        
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
    
    console.log(`📊 Remaining streams after disconnect:`, Array.from(activeStreams.keys()));
  });

  // Error handling
  socket.on('error', (error) => {
    console.error('Socket error:', error);
  });
});

// Clean up old streams periodically (every 5 minutes)
setInterval(() => {
  const now = new Date();
  let cleanedCount = 0;
  
  for (const [streamId, stream] of activeStreams.entries()) {
    // Check if stream is older than 2 hours
    const streamAge = now - stream.createdAt;
    if (streamAge > 2 * 60 * 60 * 1000) { // 2 hours
      console.log(`🧹 Cleaning up old stream: ${streamId}`);
      activeStreams.delete(streamId);
      cleanedCount++;
    }
  }
  
  if (cleanedCount > 0) {
    console.log(`🧹 Cleaned up ${cleanedCount} old streams`);
  }
}, 5 * 60 * 1000); // 5 minutes

const PORT = process.env.PORT || 3000;

server.listen(PORT, '0.0.0.0', () => {
  console.log(`
🚀 Camera Streaming Server Started!
📍 Port: ${PORT}
🌐 Health: http://localhost:${PORT}/health
📊 Streams API: http://localhost:${PORT}/api/streams
💡 Remember: Streams reset on server restart
  `);
});