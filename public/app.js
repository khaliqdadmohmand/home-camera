class CameraStreamApp {
    constructor() {
        this.socket = null;
        this.localStream = null;
        this.peerConnection = null;
        this.currentStreamId = null;
        this.isStreamer = false;
        
        this.initializeElements();
        this.setupEventListeners();
        this.setupSocket();
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
        this.socket = io();

        this.socket.on('connect', () => {
            this.updateStatus('Connected to server', 'connected');
        });

        this.socket.on('stream-created', (data) => {
            console.log('Stream created:', data.streamId);
        });

        this.socket.on('viewer-joined', (data) => {
            if (this.isStreamer) {
                this.viewerCount.textContent = data.viewerCount;
            }
        });

        this.socket.on('viewer-left', (data) => {
            if (this.isStreamer) {
                this.viewerCount.textContent = data.viewerCount;
            }
        });

        this.socket.on('stream-not-found', () => {
            this.updateStatus('Stream not found', 'disconnected');
            alert('Stream not found. Please check the Stream ID.');
        });

        this.socket.on('stream-ended', () => {
            this.updateStatus('Stream ended by host', 'disconnected');
            this.remoteVideo.srcObject = null;
            this.noStreamMessage.classList.remove('hidden');
        });

        this.socket.on('offer', async (data) => {
            if (!this.isStreamer) {
                await this.handleOffer(data);
            }
        });

        this.socket.on('answer', async (data) => {
            if (this.isStreamer) {
                await this.handleAnswer(data);
            }
        });

        this.socket.on('ice-candidate', async (data) => {
            await this.handleIceCandidate(data);
        });
    }

    async startStreaming() {
        try {
            this.localStream = await navigator.mediaDevices.getUserMedia({
                video: {
                    width: { ideal: 1280 },
                    height: { ideal: 720 },
                    frameRate: { ideal: 30 }
                },
                audio: true
            });

            this.localVideo.srcObject = this.localStream;
            this.currentStreamId = this.generateStreamId();
            this.socket.emit('create-stream', this.currentStreamId);

            this.startStreamBtn.classList.add('hidden');
            this.stopStreamBtn.classList.remove('hidden');
            
            const streamUrl = `${window.location.origin}?stream=${this.currentStreamId}`;
            this.streamLink.value = streamUrl;
            this.streamLink.parentElement.parentElement.classList.remove('hidden');
            
            this.viewerCount.textContent = '0';
            this.updateStatus('Streaming live', 'connected');
            this.isStreamer = true;

        } catch (error) {
            console.error('Error starting stream:', error);
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

        this.currentStreamId = streamId;
        this.socket.emit('join-stream', streamId);
        this.updateStatus('Connecting to stream...', 'connected');
    }

    async createPeerConnection() {
        const configuration = {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' }
            ]
        };

        this.peerConnection = new RTCPeerConnection(configuration);

        this.peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                this.socket.emit('ice-candidate', {
                    candidate: event.candidate,
                    streamId: this.currentStreamId
                });
            }
        };

        return this.peerConnection;
    }

    async handleOffer(data) {
        await this.createPeerConnection();

        this.peerConnection.ontrack = (event) => {
            this.remoteVideo.srcObject = event.streams[0];
            this.noStreamMessage.classList.add('hidden');
            this.updateStatus('Watching live stream', 'connected');
        };

        await this.peerConnection.setRemoteDescription(data);
        const answer = await this.peerConnection.createAnswer();
        await this.peerConnection.setLocalDescription(answer);
        
        this.socket.emit('answer', {
            ...data,
            answer: answer
        });
    }

    async handleAnswer(data) {
        if (this.peerConnection) {
            await this.peerConnection.setRemoteDescription(data.answer);
        }
    }

    async handleIceCandidate(data) {
        if (this.peerConnection) {
            await this.peerConnection.addIceCandidate(data.candidate);
        }
    }

    showStreamerView() {
        this.streamerView.classList.remove('hidden');
        this.viewerView.classList.add('hidden');
        this.isStreamer = true;
    }

    showViewerView() {
        this.streamerView.classList.add('hidden');
        this.viewerView.classList.remove('hidden');
        this.isStreamer = false;
        
        const urlParams = new URLSearchParams(window.location.search);
        const streamId = urlParams.get('stream');
        if (streamId) {
            this.streamIdInput.value = streamId;
            this.joinStream();
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

document.addEventListener('DOMContentLoaded', () => {
    new CameraStreamApp();
});