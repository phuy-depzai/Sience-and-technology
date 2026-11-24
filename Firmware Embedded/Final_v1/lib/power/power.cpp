#include "power.h"
#include <Wire.h>
#include "stm32f1xx_hal.h"

extern "C" void SystemClock_Config(void);

// Flag báo main.cpp vừa wake
bool g_just_woke = false;

void enter_stop()
{
    Serial.flush();
    Serial1.flush();
    Wire.end();

    __HAL_RCC_USART1_CLK_DISABLE();
    __HAL_RCC_USART2_CLK_DISABLE();
    __HAL_RCC_USART3_CLK_DISABLE();  // Thêm USART3 (ZE07)
    __HAL_RCC_SPI1_CLK_DISABLE();
    
    // ⚠️ THÊM 2 DÒNG NÀY (Xóa cờ EXTI trước khi ngủ)
    EXTI->PR = EXTI_PR_PR0;
    __HAL_GPIO_EXTI_CLEAR_IT(GPIO_PIN_0);

    HAL_SuspendTick();
    HAL_PWR_EnterSTOPMode(PWR_MAINREGULATOR_ON, PWR_STOPENTRY_WFI);
    wake_config();
}

void wake_config()
{
    SystemClock_Config();
    HAL_ResumeTick();

    // === BUS RECOVERY (giải phóng SDA nếu bị kẹt) ===
    pinMode(PB7, INPUT_PULLUP);
    pinMode(PB6, OUTPUT);
    digitalWrite(PB6, HIGH);
    delayMicroseconds(10);
    for (int i = 0; i < 9; i++) {
        digitalWrite(PB6, LOW);  delayMicroseconds(5);
        digitalWrite(PB6, HIGH); delayMicroseconds(5);
    }
    pinMode(PB7, OUTPUT);
    digitalWrite(PB7, LOW);  delayMicroseconds(5);
    digitalWrite(PB6, HIGH); delayMicroseconds(5);
    digitalWrite(PB7, HIGH); delayMicroseconds(5);
    pinMode(PB7, INPUT_PULLUP);

    Wire.begin();
    Wire.setClock(100000);
    delay(10);

    Serial1.begin(115200);
    Serial2.begin(9600);
    Serial3.begin(9600);

    g_just_woke = true;
}