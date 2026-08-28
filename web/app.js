const express = require('express');
const path = require('path');

const app = express();
const PORT = 3000;

// Cấu hình Express phục vụ file tĩnh (HTML, CSS, JS) trong thư mục 'public'
app.use(express.static(path.join(__dirname, 'public')));

// Khởi chạy server
app.listen(PORT, () => {
  console.log(`Server đang chạy tại: http://localhost:${PORT}`);
});