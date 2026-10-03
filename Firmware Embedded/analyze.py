import json
import os
from pathlib import Path
from statistics import mean, stdev, median
from datetime import datetime


# ================= FILE =================

INPUT = Path.home() / "Documents" / "test5.jsonl"

OUTPUT = INPUT.with_name(
    INPUT.stem + "_analyze.txt"
)


# ================= DATA =================

total = 0
json_error = 0

null_record = 0
missing_field = 0

imu_ok = 0
imu_error = 0

temps = []
hums = []
rssis = []

keys = []

packet_loss = 0
loss_events = []

reset_count = 0
reset_events = []

first_packet = None
last_packet = None
prev_packet = None

first_time = None
last_time = None

bad_lines = []

required = [
    "imu",
    "temp",
    "hum",
    "time",
    "key",
    "rssi",
    "packet"
]


# ================= LOAD =================

with open(INPUT, "r", encoding="utf-8") as f:

    for line_number, line in enumerate(f, 1):

        line = line.strip()

        if not line:
            continue

        total += 1


        try:
            data = json.loads(line)

        except:

            json_error += 1
            bad_lines.append(
                f"Line {line_number}: JSON ERROR"
            )

            continue


        # -------- missing --------

        for k in required:

            if k not in data:

                missing_field += 1

                bad_lines.append(
                    f"Line {line_number}: missing {k}"
                )

                break



        # -------- null --------

        if any(
            v is None
            for v in data.values()
        ):

            null_record += 1



        # -------- imu --------

        if data.get("imu") == "0x69":

            imu_ok += 1

        else:

            imu_error += 1

            bad_lines.append(
                f"Line {line_number}: IMU {data.get('imu')}"
            )



        # -------- sensor --------


        if isinstance(data.get("temp"), (int,float)):

            temps.append(
                data["temp"]
            )


        if isinstance(data.get("hum"), (int,float)):

            hums.append(
                data["hum"]
            )


        if isinstance(data.get("rssi"), (int,float)):

            rssis.append(
                data["rssi"]
            )


        # -------- key --------

        keys.append(
            data.get("key","")
        )



        # -------- packet --------

        p = data.get("packet")


        if isinstance(p,int):

            if first_packet is None:

                first_packet = p


            if prev_packet is not None:


                diff = p - prev_packet


                if diff < 0:

                    reset_count += 1

                    reset_events.append(
                        {
                            "before": prev_packet,
                            "after": p,
                            "time": data.get("time")
                        }
                    )


                elif diff > 1:

                    lost = diff - 1

                    packet_loss += lost

                    loss_events.append(
                        {
                            "from":prev_packet,
                            "to":p,
                            "lost":lost,
                            "time":data.get("time")
                        }
                    )


            prev_packet = p
            last_packet = p



        # -------- time --------

        if data.get("time"):

            if first_time is None:

                first_time = data["time"]

            last_time = data["time"]




# ================= FUNCTION =================


def stat(name, arr):

    if not arr:

        return (
            f"{name}\n"
            "  No data\n"
        )


    avg = mean(arr)

    sd = stdev(arr) if len(arr)>1 else 0


    return (
        f"{name}\n"
        f"  Min    : {min(arr):.2f}\n"
        f"  Max    : {max(arr):.2f}\n"
        f"  Avg    : {avg:.2f}\n"
        f"  Std    : {sd:.2f}\n"
        f"  Median : {median(arr):.2f}\n\n"
    )



def duration():

    try:

        a = datetime.strptime(
            first_time,
            "%H:%M:%S"
        )

        b = datetime.strptime(
            last_time,
            "%H:%M:%S"
        )


        if b < a:

            b = b.replace(
                day=2
            )


        sec = (
            b-a
        ).total_seconds()


        return sec


    except:

        return 0




# ================= REPORT =================


report = []


def out(x=""):

    print(x)

    report.append(
        str(x)
    )



out("="*60)
out("ESP32 GATEWAY LOG ANALYZER")
out("="*60)

out(
    f"File          : {INPUT}"
)

out()

out(
    f"Total record  : {total}"
)

out(
    f"JSON error    : {json_error}"
)

out(
    f"Null record   : {null_record}"
)

out(
    f"Missing field : {missing_field}"
)


out()

out(
    f"Start time    : {first_time}"
)

out(
    f"End time      : {last_time}"
)



sec = duration()


if sec:

    out(
        f"Duration      : {sec/3600:.2f} hour"
    )

    out(
        f"Packet/sec    : {total/sec:.3f}"
    )



out()

out("PACKET")
out("-"*20)

out(
    f"First packet  : {first_packet}"
)

out(
    f"Last packet   : {last_packet}"
)

out(
    f"Packet loss   : {packet_loss}"
)

out(
    f"Reset count   : {reset_count}"
)


out()

out("IMU")
out("-"*20)

out(
    f"0x69          : {imu_ok}"
)

out(
    f"Wrong         : {imu_error}"
)


out()

out(
    stat(
        "Temperature",
        temps
    )
)

out(
    stat(
        "Humidity",
        hums
    )
)

out(
    stat(
        "RSSI",
        rssis
    )
)



out("KEYPAD")
out("-"*20)

out(
    f"Empty         : {keys.count('')}"
)

out(
    f"Pressed       : {len(keys)-keys.count('')}"
)



if rssis:

    r = mean(rssis)

    if r >= -50:
        q = "Excellent"

    elif r >= -60:
        q = "Good"

    elif r >= -70:
        q = "Weak"

    else:
        q = "Poor"


    out()

    out(
        f"RSSI Quality  : {q}"
    )



out()

out("ERROR EVENTS")
out("-"*20)


for e in loss_events[:20]:

    out(
        f"LOSS {e}"
    )


for e in reset_events:

    out(
        f"RESET {e}"
    )


if bad_lines:

    out()

    out("BAD LINES")

    for x in bad_lines[:50]:

        out(x)



out()

if (
    json_error == 0
    and null_record == 0
    and imu_error == 0
    and packet_loss == 0
    and reset_count == 0
):

    out("RESULT : PASS")

else:

    out("RESULT : WARNING")


out("="*60)



# ================= SAVE =================


with open(
    OUTPUT,
    "w",
    encoding="utf-8"
) as f:

    f.write(
        "\n".join(report)
    )


print()

print(
    "Saved:",
    OUTPUT
)