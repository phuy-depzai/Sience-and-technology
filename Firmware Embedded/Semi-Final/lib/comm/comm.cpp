#include "comm.h"
#include "ps.h"
void uart_read_pass()
{
    while(Serial1.available())
    {
        String line = Serial1.readStringUntil('\n');
        line.trim();

        if(!line.startsWith("PASS:")) continue;

        char lv = line.charAt(5);
        if(lv != 'A' && lv != 'B') continue;

        uint8_t pass[PS_LEN];
        for(int i = 0; i < PS_LEN; i++)
        {
            pass[i] = line.charAt(6 + i) - '0';
            if(pass[i] < 1 || pass[i] > 9) return;
        }

        ps_save(lv, pass);
        ps_set_used(lv, 0);

        Serial.print("[UART] Saved pass ");
        Serial.println(lv);
    }
}

void uart_send_data(SensorData d)
{
    Serial1.print("{\"t\":");
    Serial1.print(d.temp, 2);
    Serial1.print(",\"h\":");
    Serial1.print(d.hum, 2);
    Serial1.print(",\"v\":");
    Serial1.print(d.vpin, 3);
    Serial1.print(",\"i\":");
    Serial1.print(d.ipin, 3);
    Serial1.println("}");
}