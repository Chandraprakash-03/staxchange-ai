const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');

// Load environment variables
dotenv.config();

// Import routes
const githubRoutes = require('./routes/github');
const convertRoutes = require('./routes/convert');
const authRoutes = require('./routes/auth');
const downloadRoutes = require('./routes/download');        // New route
const githubCreateRoutes = require('./routes/github-create'); // New route

const app = express();
const PORT = process.env.PORT || 3000;

// Trust proxy for proper IP detection
app.set('trust proxy', 1);

// Enhanced CORS configuration
app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    
    const allowedOrigins = [
      'http://localhost:3000',
      'http://localhost:3001',
      'http://localhost:5173',
      'http://localhost:8080',
      'http://127.0.0.1:3000',
      'http://127.0.0.1:5173'
    ];
    
    if (process.env.FRONTEND_URL) {
      allowedOrigins.push(process.env.FRONTEND_URL);
    }
    
    if (allowedOrigins.includes(origin) || process.env.NODE_ENV === 'development') {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'authorization', 
    'x-client-info', 
    'apikey', 
    'content-type',
    'x-requested-with',
    'accept',
    'origin'
  ]
}));

// Handle preflight requests
app.options('*', cors());

// Body parsing middleware with increased limits
app.use(express.json({ 
  limit: '50mb',
  verify: (req, res, buf) => {
    req.rawBody = buf;
  }
}));
app.use(express.urlencoded({ 
  extended: true, 
  limit: '50mb' 
}));

// Request timeout middleware
app.use((req, res, next) => {
  req.setTimeout(10 * 60 * 1000, () => {
    res.status(408).json({ 
      error: 'Request timeout',
      message: 'The request took too long to process'
    });
  });
  
  res.setTimeout(10 * 60 * 1000, () => {
    res.status(408).json({ 
      error: 'Response timeout',
      message: 'The response took too long to send'
    });
  });
  
  next();
});

// Request logging middleware
app.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${req.method} ${req.url} - IP: ${req.ip}`);
  next();
});

// Static files (if you have any)
app.use('/public', express.static(path.join(__dirname, 'public')));

// API Routes
app.use('/api/github', githubRoutes);
app.use('/api/convert', convertRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/download', downloadRoutes);           // New ZIP download route
app.use('/api/github-create', githubCreateRoutes);  // New GitHub repo creation route

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    version: process.env.npm_package_version || '1.0.0',
    node_version: process.version,
    environment: process.env.NODE_ENV || 'development'
  });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    message: 'StaxChange API Server',
    version: '1.0.0',
    endpoints: {
      health: '/health',
      github: '/api/github',
      convert: '/api/convert',
      auth: '/api/auth',
      download: '/api/download',
      'github-create': '/api/github-create'
    },
    docs: 'https://github.com/your-repo/staxchange-api'
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    error: 'Not Found',
    message: `Route ${req.originalUrl} not found`,
    timestamp: new Date().toISOString()
  });
});

// Global error handling middleware
app.use((err, req, res, next) => {
  console.error('Global error handler:', {
    error: err.message,
    stack: err.stack,
    url: req.url,
    method: req.method,
    timestamp: new Date().toISOString()
  });

  const isDevelopment = process.env.NODE_ENV === 'development';
  
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error',
    ...(isDevelopment && { stack: err.stack }),
    timestamp: new Date().toISOString()
  });
});

// Graceful shutdown handling
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully');
  process.exit(0);
});

// Unhandled promise rejection handling
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  if (process.env.NODE_ENV !== 'production') {
    process.exit(1);
  }
});

// Start server
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`
🚀 StaxChange API Server Started Successfully!
📊 Environment: ${process.env.NODE_ENV || 'development'}
🌐 Server running on: http://localhost:${PORT}
🔗 Health check: http://localhost:${PORT}/health
📝 API Documentation: http://localhost:${PORT}/
⏰ Started at: ${new Date().toISOString()}

📋 Available Endpoints:
   • GitHub API: /api/github
   • Convert Code: /api/convert  
   • Authentication: /api/auth
   • Download ZIP: /api/download
   • Create Repository: /api/github-create
  `);
});

// Handle server errors
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`❌ Port ${PORT} is already in use. Please try a different port.`);
    process.exit(1);
  } else {
    console.error('❌ Server error:', err);
  }
});

module.exports = app;
