#include "power.h"
#include <Wire.h>
#include "stm32f1xx_hal.h"

extern "C" void SystemClock_Config(void);

void enter_stop()
{
    Serial.flush();
    Serial1.flush();
    Wire.end();

    __HAL_RCC_USART1_CLK_DISABLE();
    __HAL_RCC_USART2_CLK_DISABLE();
    __HAL_RCC_SPI1_CLK_DISABLE();

    HAL_SuspendTick();
    HAL_PWR_EnterSTOPMode(PWR_MAINREGULATOR_ON, PWR_STOPENTRY_WFI);
    wake_config();
}

void wake_config()
{
    SystemClock_Config();
    HAL_ResumeTick();
    Wire.begin();
    Wire.setClock(100000);
    Serial1.begin(115200);
}