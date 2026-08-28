const http = require('http');

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end('<h1>Web Node.js chạy ngon lành rồi nè!</h1>');
});

server.listen(3000, () => {
  console.log('Server đang chạy tại: http://localhost:3000');
});