class CameraStreamApp {
    constructor() {
        this.socket = null;
        this.localStream = null;
        this.peerConnection = null;
        this.currentStreamId = null;
        this.isStreamer = false;
        this.streamerId = null;
        
        this.initializeElements();
        this.setupEventListeners();
        this.setupSocket();
        this.checkUrlForStreamId();
    }

    initializeElements() {
        this.streamerView = document.getElementById('streamerView');
        this.viewerView = document.getElementById('viewerView');
        this.startStreamBtn = document.getElementById('startStreamBtn');
        this.stopStreamBtn = document.getElementById('stopStreamBtn');
        this.localVideo = document.getElementById('localVideo');
        this.streamLink = document.getElementById('streamLink');
        this.copyLinkBtn = document.getElementById('copyLinkBtn');
        this.viewerCount = document.getElementById('viewerCount');
        this.streamIdInput = document.getElementById('streamIdInput');
        this.joinStreamBtn = document.getElementById('joinStreamBtn');
        this.remoteVideo = document.getElementById('remoteVideo');
        this.noStreamMessage = document.getElementById('noStreamMessage');
        this.connectionStatus = document.getElementById('connectionStatus');
        this.switchToStreamerBtn = document.getElementById('switchToStreamer');
        this.switchToViewerBtn = document.getElementById('switchToViewer');
    }

    setupEventListeners() {
        this.startStreamBtn.addEventListener('click', () => this.startStreaming());
        this.stopStreamBtn.addEventListener('click', () => this.stopStreaming());
        this.copyLinkBtn.addEventListener('click', () => this.copyStreamLink());
        this.joinStreamBtn.addEventListener('click', () => this.joinStream());
        this.streamIdInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.joinStream();
        });
        this.switchToStreamerBtn.addEventListener('click', () => this.showStreamerView());
        this.switchToViewerBtn.addEventListener('click', () => this.showViewerView());
    }

    setupSocket() {
        this.socket = io({
            transports: ['websocket', 'polling']
        });

        this.socket.on('connect', () => {
            console.log('✅ Connected to server:', this.socket.id);
            this.updateStatus('Connected to server', 'connected');
        });

        this.socket.on('disconnect', () => {
            console.log('❌ Disconnected from server');
            this.updateStatus('Disconnected from server', 'disconnected');
        });

        this.socket.on('stream-created', (data) => {
            console.log('✅ Stream created:', data.streamId);
            this.updateStatus('Stream created - Share the link below', 'connected');
        });

        this.socket.on('stream-joined', (data) => {
            console.log('✅ Joined stream:', data.streamId);
            this.streamerId = data.streamerId;
            this.updateStatus('Connected to stream - Waiting for video...', 'connected');
        });

        this.socket.on('stream-not-found', (data) => {
            console.log('❌ Stream not found:', data.streamId);
            this.updateStatus('Stream not found - Check Stream ID', 'disconnected');
            alert('Stream not found. Please check the Stream ID and make sure the streamer is online.');
        });

        this.socket.on('viewer-joined', (data) => {
            console.log('👀 Viewer joined:', data.viewerId);
            this.viewerCount.textContent = data.viewerCount;
        });

        this.socket.on('viewer-left', (data) => {
            console.log('🚪 Viewer left:', data.viewerId);
            this.viewerCount.textContent = data.viewerCount;
        });

        this.socket.on('stream-ended', () => {
            console.log('🛑 Stream ended by host');
            this.updateStatus('Stream ended by host', 'disconnected');
            this.remoteVideo.srcObject = null;
            this.noStreamMessage.classList.remove('hidden');
            alert('The stream has ended. The host stopped streaming.');
        });

        // WebRTC signaling
        this.socket.on('offer', async (data) => {
            console.log('📨 Received offer from:', data.from);
            if (!this.isStreamer) {
                await this.handleOffer(data);
            }
        });

        this.socket.on('answer', async (data) => {
            console.log('📨 Received answer from:', data.from);
            if (this.isStreamer) {
                await this.handleAnswer(data);
            }
        });

        this.socket.on('ice-candidate', async (data) => {
            console.log('❄️ Received ICE candidate from:', data.from);
            await this.handleIceCandidate(data);
        });
    }

    async startStreaming() {
        try {
            console.log('🎥 Starting stream...');
            this.updateStatus('Accessing camera...', 'connected');
            
            // Access camera
            this.localStream = await navigator.mediaDevices.getUserMedia({
                video: {
                    width: { ideal: 1280 },
                    height: { ideal: 720 },
                    frameRate: { ideal: 30 }
                },
                audio: true
            });

            this.localVideo.srcObject = this.localStream;

            // Generate stream ID
            this.currentStreamId = this.generateStreamId();
            
            // Create stream on server
            this.socket.emit('create-stream', this.currentStreamId);

            // Create peer connection for streamer
            await this.createPeerConnection();
            
            // Add local stream to peer connection
            this.localStream.getTracks().forEach(track => {
                this.peerConnection.addTrack(track, this.localStream);
            });

            // Update UI
            this.startStreamBtn.classList.add('hidden');
            this.stopStreamBtn.classList.remove('hidden');
            
            const streamUrl = `${window.location.origin}?stream=${this.currentStreamId}`;
            this.streamLink.value = streamUrl;
            this.streamLink.parentElement.parentElement.classList.remove('hidden');
            
            this.viewerCount.textContent = '0';
            this.updateStatus('Streaming live - Share the link with viewers', 'connected');
            
            this.isStreamer = true;

            console.log('✅ Streaming started with ID:', this.currentStreamId);

        } catch (error) {
            console.error('❌ Error starting stream:', error);
            this.updateStatus(`Error: ${error.message}`, 'disconnected');
            alert('Error accessing camera: ' + error.message);
        }
    }

    stopStreaming() {
        console.log('🛑 Stopping stream...');
        
        if (this.localStream) {
            this.localStream.getTracks().forEach(track => track.stop());
            this.localStream = null;
            this.localVideo.srcObject = null;
        }

        if (this.peerConnection) {
            this.peerConnection.close();
            this.peerConnection = null;
        }

        this.startStreamBtn.classList.remove('hidden');
        this.stopStreamBtn.classList.add('hidden');
        this.streamLink.parentElement.parentElement.classList.add('hidden');
        this.updateStatus('Stream ended', 'disconnected');
        this.isStreamer = false;

        console.log('✅ Stream stopped');
    }

    async joinStream() {
        const streamId = this.streamIdInput.value.trim();
        if (!streamId) {
            alert('Please enter a Stream ID');
            return;
        }

        console.log('👀 Joining stream:', streamId);
        this.currentStreamId = streamId;
        this.updateStatus('Connecting to stream...', 'connected');
        
        // First check if stream exists via API
        try {
            const response = await fetch(`/api/stream/${streamId}`);
            const data = await response.json();
            
            if (!data.exists) {
                this.updateStatus('Stream not found', 'disconnected');
                alert('Stream not found. Please check the Stream ID and make sure the streamer is online.');
                return;
            }
        } catch (error) {
            console.error('Error checking stream:', error);
        }

        // Join via socket
        this.socket.emit('join-stream', streamId);
    }

    async createPeerConnection() {
        console.log('🔗 Creating peer connection...');
        
        const configuration = {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' },
                { urls: 'stun:stun2.l.google.com:19302' }
            ]
        };

        this.peerConnection = new RTCPeerConnection(configuration);

        // Handle ICE candidates
        this.peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                console.log('❄️ Sending ICE candidate');
                this.socket.emit('ice-candidate', {
                    candidate: event.candidate,
                    streamId: this.currentStreamId
                });
            }
        };

        // Handle connection state changes
        this.peerConnection.onconnectionstatechange = () => {
            console.log('🔗 Connection state:', this.peerConnection.connectionState);
            this.updateStatus(`Connection: ${this.peerConnection.connectionState}`, 'connected');
            
            if (this.peerConnection.connectionState === 'connected') {
                console.log('✅ Peer connection established!');
                this.updateStatus('Connected - Streaming active', 'connected');
            }
        };

        // Handle track events (for viewer)
        this.peerConnection.ontrack = (event) => {
            console.log('🎬 Received remote track');
            this.remoteVideo.srcObject = event.streams[0];
            this.noStreamMessage.classList.add('hidden');
            this.updateStatus('Connected - Watching live stream', 'connected');
        };

        return this.peerConnection;
    }

    async handleOffer(data) {
        console.log('📨 Handling offer from streamer');
        
        await this.createPeerConnection();

        await this.peerConnection.setRemoteDescription(data.offer);
        const answer = await this.peerConnection.createAnswer();
        await this.peerConnection.setLocalDescription(answer);
        
        this.socket.emit('answer', {
            answer: answer,
            streamId: this.currentStreamId
        });

        console.log('✅ Sent answer to streamer');
    }

    async handleAnswer(data) {
        console.log('📨 Handling answer from viewer');
        
        if (this.peerConnection) {
            await this.peerConnection.setRemoteDescription(data.answer);
        }
    }

    async handleIceCandidate(data) {
        console.log('❄️ Handling ICE candidate');
        
        if (this.peerConnection && data.candidate) {
            await this.peerConnection.addIceCandidate(data.candidate);
        }
    }

    showStreamerView() {
        this.streamerView.classList.remove('hidden');
        this.viewerView.classList.add('hidden');
        this.isStreamer = true;
        console.log('🎥 Switched to streamer view');
    }

    showViewerView() {
        this.streamerView.classList.add('hidden');
        this.viewerView.classList.remove('hidden');
        this.isStreamer = false;
        console.log('👀 Switched to viewer view');
        
        this.checkUrlForStreamId();
    }

    checkUrlForStreamId() {
        const urlParams = new URLSearchParams(window.location.search);
        const streamId = urlParams.get('stream');
        if (streamId) {
            this.streamIdInput.value = streamId;
            console.log('🔗 Found stream ID in URL:', streamId);
            // Auto-join after a short delay
            setTimeout(() => {
                this.joinStream();
            }, 1000);
        }
    }

    copyStreamLink() {
        this.streamLink.select();
        document.execCommand('copy');
        alert('Stream link copied to clipboard!');
    }

    updateStatus(message, status) {
        this.connectionStatus.textContent = message;
        this.connectionStatus.className = `status-${status}`;
    }

    generateStreamId() {
        return Math.random().toString(36).substring(2, 8).toUpperCase();
    }
}

// Initialize the app when the page loads
document.addEventListener('DOMContentLoaded', () => {
    console.log('🚀 Initializing Camera Stream App...');
    window.cameraApp = new CameraStreamApp();
});