#ifndef LORA_H
#define LORA_H

#include <Arduino.h>

bool LoRa_Init_TX(Stream* serial);
bool LoRa_IsReady();
bool LoRa_SendBurst(const char* data, int n_packets, uint32_t spacing_ms);

#endif