const http = require('http');
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
require('dotenv').config();

// Connect database
require('./db');

// Connect routers
const likesRoutes = require('../routes/likes');

// Connect Socket.IO manager
const { initSocketIO } = require('./socketManager');

const app = express();
const PORT = process.env.PORT || 7000;

app.use(cors({ origin: '*' }));
app.use(bodyParser.json());

// Use routes
app.use(likesRoutes);

// Wrap express with http server for Socket.IO
const httpServer = http.createServer(app);

// Initialize Socket.IO
initSocketIO(httpServer);

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`User Likes Service is running on http://localhost:${PORT}`);
});
