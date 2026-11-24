#!/usr/bin/env python3
"""
TX test script for RA-08H kit (ASR6601 LoRa test firmware).
Kit này cắm USB0 (vd /dev/ttyUSB0).
"""

import glob
import sys
import serial
import time

BAUD = 9600


def pick_port():
    """Tự động chọn cổng ttyUSB có số nhỏ nhất làm TX."""
    ports = sorted(glob.glob("/dev/ttyUSB*"))
    if not ports:
        sys.exit("[!] Không tìm thấy /dev/ttyUSB* nào. Kiểm tra lại USB đã cắm chưa (ls /dev/ttyUSB*).")
    if len(ports) < 2:
        print(f"[!] Chỉ thấy 1 port ({ports[0]}) -- dùng port này cho TX, nhưng nhớ cắm cả 2 kit để test.")
    return ports[0]


PORT = pick_port()

LOCAL_ADDR = 1       # địa chỉ của chính kit TX này
TARGET_ADDR = 2       # phải khớp với CADDRSET bên kit RX

# freq, data_rate(0=SF12..7=SF5, SF=12-dr), bandwidth(0=125kHz), code_rate(1=4/5), pwr(dBm), iq(0=off)
FREQ = 923000000       # băng AS923 (VN), không dùng 470MHz (băng TQ)
DATA_RATE = 3           # SF9 - cân bằng tốc độ/tầm xa (airtime ~1-1.3s với payload JSON thực tế)
BANDWIDTH = 0
CODE_RATE = 1
PWR = 22
IQ = 0


def send_cmd(ser, cmd, wait=0.3):
    """Gửi 1 lệnh AT, in phản hồi, và cảnh báo nếu thấy lỗi thật
    (+CME ERROR) -- firmware này không trả 'OK' kiểu AT chuẩn, nên
    không check chữ OK."""
    print(f">> {cmd}")
    ser.write((cmd + "\r\n").encode())
    time.sleep(wait)
    resp = ""
    while ser.in_waiting:
        line = ser.readline().decode(errors="replace").rstrip()
        if line:
            print(f"   {line}")
            resp += line + "\n"
    if "+CME ERROR" in resp:
        print("   [!] Lệnh bị lỗi (firmware không nhận dạng được) -- kiểm tra lại cú pháp.")
    return resp


def main():
    print(f"[i] Dùng port: {PORT} (TX)")
    ser = serial.Serial(PORT, BAUD, timeout=1)
    time.sleep(0.5)

    # Đọc sạch mọi banner/log cũ còn sót trong buffer (vd log khởi động khi reset)
    time.sleep(0.3)
    while ser.in_waiting:
        print("   [boot]", ser.readline().decode(errors="replace").rstrip())

    # Phòng trường hợp board đang kẹt ở transparent mode từ lần test trước
    # (board không tự reset khi mở lại cổng serial) -> thoát ra trước khi set lệnh.
    send_cmd(ser, "+++", wait=0.3)

    send_cmd(ser, f"AT+CADDRSET={LOCAL_ADDR}")
    send_cmd(ser, f"AT+CTXADDRSET={TARGET_ADDR}")

    print(f"\n[!] Nhớ gắn antenna trước khi vào TX (pwr={PWR}dBm) -- không có antenna có thể hỏng PA.\n")
    send_cmd(
        ser,
        f"AT+CTX={FREQ},{DATA_RATE},{BANDWIDTH},{CODE_RATE},{PWR},{IQ}",
        wait=0.5,
    )

    print("\nĐã vào transparent mode. Gõ text rồi Enter để gửi, 'exit' để thoát.\n")
    try:
        while True:
            msg = input("TX> ")
            if msg.strip().lower() == "exit":
                try:
                    ser.write(b"+++\r\n")
                    time.sleep(0.3)
                except (serial.SerialException, OSError):
                    pass
                break
            try:
                ser.write((msg + "\r\n").encode())
                time.sleep(0.3)
                while ser.in_waiting:
                    line = ser.readline().decode(errors="replace").rstrip()
                    if line:
                        print(f"   {line}")
            except (serial.SerialException, OSError) as e:
                print(f"   [!] Mất kết nối cổng serial ({e}). Kiểm tra lại dây/USB rồi chạy lại script.")
                break
    except KeyboardInterrupt:
        pass
    finally:
        try:
            ser.close()
        except Exception:
            pass


if __name__ == "__main__":
    main()
