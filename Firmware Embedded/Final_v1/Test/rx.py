#!/usr/bin/env python3
"""
RX test script for RA-08H kit (ASR6601 LoRa test firmware).
Kit này cắm USB1 (vd /dev/ttyUSB1).
"""

import glob
import sys
import serial
import time

BAUD = 9600


def pick_port():
    """Tự động chọn cổng ttyUSB có số lớn nhất làm RX."""
    ports = sorted(glob.glob("/dev/ttyUSB*"))
    if not ports:
        sys.exit("[!] Không tìm thấy /dev/ttyUSB* nào. Kiểm tra lại USB đã cắm chưa (ls /dev/ttyUSB*).")
    if len(ports) < 2:
        print(f"[!] Chỉ thấy 1 port ({ports[-1]}) -- dùng port này cho RX, nhưng nhớ cắm cả 2 kit để test.")
    return ports[-1]


PORT = pick_port()

LOCAL_ADDR = 2  # phải khớp với CTXADDRSET bên kit TX

# freq, data_rate(0=SF12..7=SF5, SF=12-dr), bandwidth(0=125kHz), code_rate(1=4/5), iq(0=off)
# -> phải trùng y hệt 4 tham số này với bên TX (trừ pwr là riêng của TX)
FREQ = 923000000  # băng AS923 (VN), không dùng 470MHz (băng TQ)
DATA_RATE = 3      # SF9 - cân bằng tốc độ/tầm xa (airtime ~1-1.3s với payload JSON thực tế)
BANDWIDTH = 0
CODE_RATE = 1
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
    print(f"[i] Dùng port: {PORT} (RX)")
    ser = serial.Serial(PORT, BAUD, timeout=1)
    time.sleep(0.5)

    # Đọc sạch mọi banner/log cũ còn sót trong buffer
    time.sleep(0.3)
    while ser.in_waiting:
        print("   [boot]", ser.readline().decode(errors="replace").rstrip())

    # Phòng trường hợp kit này từng bị lỡ set AT+CTX (vd cắm lộn USB) và
    # đang kẹt transparent mode -- giống hệt lý do thêm vào tx.py.
    send_cmd(ser, "+++", wait=0.3)

    send_cmd(ser, f"AT+CADDRSET={LOCAL_ADDR}")
    # dùng CRXS để in ra dạng string cho dễ đọc
    send_cmd(ser, f"AT+CRXS={FREQ},{DATA_RATE},{BANDWIDTH},{CODE_RATE},{IQ}", wait=0.5)

    print("\nĐang lắng nghe gói tin... (Ctrl+C để dừng)\n")
    try:
        while True:
            try:
                if ser.in_waiting:
                    line = ser.readline().decode(errors="replace").rstrip()
                    if line:
                        print(line)
            except (serial.SerialException, OSError) as e:
                print(f"\n[!] Mất kết nối cổng serial ({e}). Kiểm tra lại dây/USB rồi chạy lại script.")
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
