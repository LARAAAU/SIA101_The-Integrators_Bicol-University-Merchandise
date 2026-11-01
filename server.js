// Local development server. On Vercel, api/index.js is used instead.
require('dotenv').config();
const express = require('express');
const path = require('path');
const app = require('./api/index');

app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`MerchSys running at http://localhost:${PORT}`));
