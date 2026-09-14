let isConnected = false; // Biến cờ theo dõi trạng thái kết nối

const client = new Paho.MQTT.Client(
  "broker.hivemq.com",
  8884,
  "web_" + parseInt(Math.random() * 10000, 10)
);

client.onConnectionLost = function(responseObject) {
  isConnected = false;
  console.log("Mất kết nối MQTT: " + responseObject.errorMessage);
};

client.onMessageArrived = function(message) {
  console.log("Nhận dữ liệu từ ESP32:", message.payloadString);
  const dataElem = document.getElementById("data");
  if (dataElem) {
    dataElem.innerText = message.payloadString;
  }
};

client.connect({
  useSSL: true,
  timeout: 5,
  onSuccess: function() {
    isConnected = true; // Bật cờ thành công
    console.log("Web connected successfully!");
    client.subscribe("esp32/test/data");
  },
  onFailure: function(message) {
    isConnected = false;
    console.log("Kết nối Broker thất bại: " + message.errorMessage);
  }
});

function sendControl(cmd) {
  // Kiểm tra cờ thay vì kiểm tra client.isConnected()
  if (isConnected) {
    const message = new Paho.MQTT.Message(cmd);
    message.destinationName = "esp32/test/control";
    client.send(message);
    console.log("Đã gửi lệnh thành công:", cmd);
  } else {
    alert("Chưa kết nối được với MQTT Broker!");
  }
}