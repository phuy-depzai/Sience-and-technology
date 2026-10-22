import serial
import time

port = '/dev/ttyUSB1'
bauds = [115200, 9600, 921600]

for baud in bauds:
    print(f"--- Đang thử Baudrate: {baud} ---")
    try:
        # Mở cổng
        ser = serial.Serial(port, baud, timeout=1)
        time.sleep(1) # Chờ module ổn định
        
        # Gửi lệnh AT
        ser.write(b'AT\r\n')
        time.sleep(1)
        
        # Đọc kết quả
        response = ser.read_all()
        
        if response:
            print(f"-> NHẬN ĐƯỢC: {response}")
        else:
            print("-> Im lặng (Không có phản hồi)")
            
        ser.close()
    except Exception as e:
        print(f"Lỗi mở cổng: {e}")
    print()