// Khởi tạo kết nối WebSocket với HiveMQ Broker
const client = new Paho.MQTT.Client("broker.hivemq.com", 8000, "web_" + parseInt(Math.random() * 1000, 10));

// Báo lỗi nếu mất kết nối
client.onConnectionLost = function(responseObject) {
  console.log("Mất kết nối MQTT: " + responseObject.errorMessage);
};

// Nhận dữ liệu gửi từ ESP32 lên và hiển thị lên web
client.onMessageArrived = function(message) {
  console.log("Nhận dữ liệu:", message.payloadString);
  document.getElementById("data").innerText = message.payloadString;
};

// Kết nối tới broker
client.connect({
  onSuccess: function() {
    console.log("Web connected!");
    client.subscribe("esp32/test/data"); // Topic nhận dữ liệu
  }
});

// Hàm gửi lệnh ON/OFF xuống ESP32
function sendControl(cmd) {
  if (client.isConnected()) {
    const message = new Paho.MQTT.Message(cmd);
    message.destinationName = "esp32/test/control"; // Topic gửi lệnh
    client.send(message);
    console.log("Đã gửi lệnh:", cmd);
  } else {
    alert("Chưa kết nối được với MQTT Broker!");
  }
}