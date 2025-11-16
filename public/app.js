class CameraStreamApp {
    constructor() {
        this.socket = null;
        this.localStream = null;
        this.peerConnection = null;
        this.currentStreamId = null;
        this.isStreamer = false;
        this.streamerId = null;
        this.viewerId = null;
        this.hasUserInteracted = false;
        
        this.initializeElements();
        this.setupEventListeners();
        this.setupSocket();
        this.checkUrlForStreamId();
        
        // Add global click handler for user interaction
        document.addEventListener('click', () => {
            this.hasUserInteracted = true;
        }, { once: true });
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
        
        // Play button elements
        this.playOverlay = document.getElementById('playOverlay');
        this.playVideoBtn = document.getElementById('playVideoBtn');
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
        
        // Play button event listener
        this.playVideoBtn.addEventListener('click', () => this.playRemoteVideo());
        
        // Also try to play when user taps anywhere on the video wrapper
        this.remoteVideo.parentElement.addEventListener('click', () => {
            if (this.remoteVideo.srcObject && !this.remoteVideo.playing) {
                this.playRemoteVideo();
            }
        });
    }

    setupSocket() {
        this.socket = io({
            transports: ['websocket', 'polling']
        });

        this.socket.on('connect', () => {
            console.log('✅ Connected to server with ID:', this.socket.id);
            this.updateStatus('Connected to server', 'connected');
        });

        this.socket.on('stream-created', (data) => {
            console.log('✅ Stream created:', data.streamId);
            this.updateStatus('Stream active - Share the link with viewers', 'connected');
        });

        this.socket.on('stream-joined', (data) => {
            console.log('✅ Joined stream:', data.streamId, 'Streamer:', data.streamerId);
            this.streamerId = data.streamerId;
            this.updateStatus('Connected to stream - Setting up video...', 'connected');
        });

        this.socket.on('stream-not-found', (data) => {
            console.log('❌ Stream not found:', data.streamId);
            this.updateStatus('Stream not found', 'disconnected');
        });

        this.socket.on('viewer-joined', (data) => {
            console.log('👀 Viewer joined:', data.viewerId);
            this.viewerCount.textContent = data.viewerCount;
            this.viewerId = data.viewerId;
        });

        this.socket.on('create-offer', async (data) => {
            console.log('📨 Request to create offer for viewer:', data.viewerId);
            if (this.isStreamer) {
                await this.createOfferForViewer(data.viewerId);
            }
        });

        this.socket.on('offer', async (data) => {
            console.log('📨 Received offer from streamer:', data.from);
            if (!this.isStreamer) {
                await this.handleOffer(data);
            }
        });

        this.socket.on('answer', async (data) => {
            console.log('📨 Received answer from viewer:', data.from);
            if (this.isStreamer) {
                await this.handleAnswer(data);
            }
        });

        this.socket.on('ice-candidate', async (data) => {
            console.log('❄️ Received ICE candidate from:', data.from);
            await this.handleIceCandidate(data);
        });

        this.socket.on('stream-ended', () => {
            console.log('🛑 Stream ended by host');
            this.updateStatus('Stream ended', 'disconnected');
            this.remoteVideo.srcObject = null;
            this.noStreamMessage.classList.remove('hidden');
            this.playOverlay.classList.add('hidden');
        });
    }

    async startStreaming() {
        try {
            this.updateStatus('Starting camera...', 'connected');
            
            // Access camera with simpler constraints
            this.localStream = await navigator.mediaDevices.getUserMedia({
                video: {
                    width: { ideal: 640 },
                    height: { ideal: 480 },
                    frameRate: { ideal: 24 }
                },
                audio: true
            });

            this.localVideo.srcObject = this.localStream;

            // Generate stream ID
            this.currentStreamId = this.generateStreamId();
            
            // Create stream on server
            this.socket.emit('create-stream', this.currentStreamId);

            // Update UI
            this.startStreamBtn.classList.add('hidden');
            this.stopStreamBtn.classList.remove('hidden');
            
            const streamUrl = `${window.location.origin}?stream=${this.currentStreamId}`;
            this.streamLink.value = streamUrl;
            this.streamLink.parentElement.parentElement.classList.remove('hidden');
            
            this.viewerCount.textContent = '0';
            this.updateStatus('Streaming live - Waiting for viewers...', 'connected');
            
            this.isStreamer = true;

            console.log('✅ Streaming started with ID:', this.currentStreamId);

        } catch (error) {
            console.error('❌ Error starting stream:', error);
            this.updateStatus(`Error: ${error.message}`, 'disconnected');
            alert('Error accessing camera: ' + error.message);
        }
    }

    stopStreaming() {
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
        
        this.socket.emit('join-stream', streamId);
    }

    async createOfferForViewer(viewerId) {
        try {
            console.log('🎯 Creating offer for viewer:', viewerId);
            
            if (!this.peerConnection) {
                await this.createPeerConnection();
                
                // Add all tracks from local stream
                this.localStream.getTracks().forEach(track => {
                    this.peerConnection.addTrack(track, this.localStream);
                });
            }

            const offer = await this.peerConnection.createOffer();
            await this.peerConnection.setLocalDescription(offer);
            
            console.log('📤 Sending offer to viewer:', viewerId);
            
            this.socket.emit('offer', {
                offer: offer,
                targetViewerId: viewerId,
                streamId: this.currentStreamId
            });

        } catch (error) {
            console.error('❌ Error creating offer:', error);
        }
    }

    async createPeerConnection() {
        console.log('🔗 Creating peer connection...');
        
        const configuration = {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' }
            ],
            iceCandidatePoolSize: 10
        };

        this.peerConnection = new RTCPeerConnection(configuration);

        // Handle ICE candidates
        this.peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                const target = this.isStreamer ? this.viewerId : this.streamerId;
                if (target) {
                    this.socket.emit('ice-candidate', {
                        candidate: event.candidate,
                        target: target,
                        streamId: this.currentStreamId
                    });
                }
            }
        };

        // Handle connection state
        this.peerConnection.onconnectionstatechange = () => {
            console.log('🔗 Connection state:', this.peerConnection.connectionState);
            this.updateStatus(`Connection: ${this.peerConnection.connectionState}`, 'connected');
            
            if (this.peerConnection.connectionState === 'connected') {
                console.log('✅ Peer connection established!');
                this.updateStatus('Connected - Tap play to start video', 'connected');
            }
        };

        // Handle track events (for viewer)
        this.peerConnection.ontrack = (event) => {
            console.log('🎬 Received remote track, streams:', event.streams.length);
            if (event.streams && event.streams[0]) {
                this.remoteVideo.srcObject = event.streams[0];
                this.noStreamMessage.classList.add('hidden');
                this.updateStatus('Connected - Tap the play button to start video', 'connected');
                
                // Show play button instead of auto-playing
                this.playOverlay.classList.remove('hidden');
                
                // Try to play automatically if user has already interacted
                if (this.hasUserInteracted) {
                    setTimeout(() => {
                        this.playRemoteVideo();
                    }, 1000);
                }
            }
        };

        return this.peerConnection;
    }

    async playRemoteVideo() {
        try {
            console.log('▶️ Attempting to play video...');
            
            // Ensure video has source
            if (!this.remoteVideo.srcObject) {
                console.log('❌ No video source available');
                return;
            }
            
            // Set muted to help with autoplay restrictions
            this.remoteVideo.muted = true;
            
            // Try to play
            await this.remoteVideo.play();
            
            // If successful, hide the play button
            this.playOverlay.classList.add('hidden');
            this.updateStatus('Connected - Watching live stream', 'connected');
            
            console.log('✅ Video playback started successfully');
            
            // After successful play, try to unmute if needed
            setTimeout(() => {
                if (this.remoteVideo.muted) {
                    this.remoteVideo.muted = false;
                }
            }, 1000);
            
        } catch (error) {
            console.error('❌ Error playing video:', error);
            this.updateStatus('Tap play button to start video', 'connected');
            
            // Show specific error message to user
            if (error.name === 'NotAllowedError') {
                this.playOverlay.classList.remove('hidden');
                this.playVideoBtn.textContent = '▶️ Tap to Play Video (Browser blocked autoplay)';
            }
        }
    }

    async handleOffer(data) {
        try {
            console.log('📨 Handling offer from streamer');
            
            await this.createPeerConnection();
            
            // Set remote description
            await this.peerConnection.setRemoteDescription(data.offer);
            
            // Create answer
            const answer = await this.peerConnection.createAnswer();
            await this.peerConnection.setLocalDescription(answer);
            
            // Send answer back to streamer
            this.socket.emit('answer', {
                answer: answer,
                targetStreamerId: data.from,
                streamId: this.currentStreamId
            });
            
            console.log('✅ Sent answer to streamer');

        } catch (error) {
            console.error('❌ Error handling offer:', error);
        }
    }

    async handleAnswer(data) {
        try {
            console.log('📨 Handling answer from viewer');
            
            if (this.peerConnection) {
                await this.peerConnection.setRemoteDescription(data.answer);
            }
        } catch (error) {
            console.error('❌ Error handling answer:', error);
        }
    }

    async handleIceCandidate(data) {
        try {
            if (this.peerConnection && data.candidate) {
                await this.peerConnection.addIceCandidate(data.candidate);
            }
        } catch (error) {
            console.error('❌ Error adding ICE candidate:', error);
        }
    }

    showStreamerView() {
        this.streamerView.classList.remove('hidden');
        this.viewerView.classList.add('hidden');
        this.isStreamer = true;
        this.hasUserInteracted = true; // Switching views counts as interaction
    }

    showViewerView() {
        this.streamerView.classList.add('hidden');
        this.viewerView.classList.remove('hidden');
        this.isStreamer = false;
        this.hasUserInteracted = true; // Switching views counts as interaction
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
            }, 500);
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

// Initialize the app
document.addEventListener('DOMContentLoaded', () => {
    console.log('🚀 Initializing Camera Stream App...');
    window.cameraApp = new CameraStreamApp();
});