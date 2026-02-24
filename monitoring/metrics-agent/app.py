import asyncio

import json

import os

import time

from datetime import datetime, timezone


import psutil

import websockets

from influxdb_client import InfluxDBClient, Point, WriteOptions


POLL_SECONDS = float(os.getenv("POLL_SECONDS", "5"))


INFLUX_URL = os.getenv("INFLUX_URL", "http://influxdb:8086")

INFLUX_TOKEN = os.getenv("INFLUX_TOKEN", "")

INFLUX_ORG = os.getenv("INFLUX_ORG", "iliagpt")

INFLUX_BUCKET = os.getenv("INFLUX_BUCKET", "system_metrics")


WS_HOST = os.getenv("WS_HOST", "0.0.0.0")  # nosec B104

WS_PORT = int(os.getenv("WS_PORT", "9105"))


clients = set()


def snapshot():

    vm = psutil.virtual_memory()

    du = psutil.disk_usage("/")

    net = psutil.net_io_counters()

    disk = psutil.disk_io_counters()


    cpu = psutil.cpu_percent(interval=None)


    out = {

        "ts": datetime.now(timezone.utc).isoformat(),

        "cpu_percent": cpu,

        "mem_percent": vm.percent,

        "mem_used_bytes": vm.used,

        "mem_total_bytes": vm.total,

        "disk_percent": du.percent,

        "disk_used_bytes": du.used,

        "disk_total_bytes": du.total,

        "net_bytes_sent": net.bytes_sent,

        "net_bytes_recv": net.bytes_recv,

        "disk_read_bytes": disk.read_bytes if disk else None,

        "disk_write_bytes": disk.write_bytes if disk else None,

        # Temperatura (no siempre disponible en VPS)

        "temperature_c": None,

        "temperature_supported": False,

    }


    try:

        temps = psutil.sensors_temperatures(fahrenheit=False)

        # intenta escoger una temperatura cualquiera

        for _name, entries in temps.items():

            if entries:

                out["temperature_c"] = float(entries[0].current)

                out["temperature_supported"] = True

                break

    except Exception:

        pass


    return out


async def ws_handler(websocket):

    clients.add(websocket)

    try:

        await websocket.send(json.dumps({"type": "hello", "poll_seconds": POLL_SECONDS}))

        while True:

            await asyncio.sleep(60)

    finally:

        clients.discard(websocket)


async def broadcast(msg: dict):

    if not clients:

        return

    data = json.dumps({"type": "metrics", "data": msg})

    dead = []

    for ws in clients:

        try:

            await ws.send(data)

        except Exception:

            dead.append(ws)

    for ws in dead:

        clients.discard(ws)


async def loop():

    client = None

    write_api = None


    if INFLUX_TOKEN:

        client = InfluxDBClient(url=INFLUX_URL, token=INFLUX_TOKEN, org=INFLUX_ORG)

        write_api = client.write_api(write_options=WriteOptions(batch_size=1, flush_interval=1_000))


    # “warm up” cpu_percent

    psutil.cpu_percent(interval=None)


    while True:

        s = snapshot()


        # WS

        await broadcast(s)


        # Influx

        if write_api:

            p = (

                Point("system")

                .field("cpu_percent", float(s["cpu_percent"]))

                .field("mem_percent", float(s["mem_percent"]))

                .field("mem_used_bytes", int(s["mem_used_bytes"]))

                .field("mem_total_bytes", int(s["mem_total_bytes"]))

                .field("disk_percent", float(s["disk_percent"]))

                .field("disk_used_bytes", int(s["disk_used_bytes"]))

                .field("disk_total_bytes", int(s["disk_total_bytes"]))

                .field("net_bytes_sent", int(s["net_bytes_sent"]))

                .field("net_bytes_recv", int(s["net_bytes_recv"]))

            )

            if s["disk_read_bytes"] is not None:

                p = p.field("disk_read_bytes", int(s["disk_read_bytes"]))

            if s["disk_write_bytes"] is not None:

                p = p.field("disk_write_bytes", int(s["disk_write_bytes"]))

            if s["temperature_supported"] and s["temperature_c"] is not None:

                p = p.field("temperature_c", float(s["temperature_c"]))

            write_api.write(bucket=INFLUX_BUCKET, org=INFLUX_ORG, record=p)


        await asyncio.sleep(POLL_SECONDS)


async def main():

    ws_server = await websockets.serve(ws_handler, WS_HOST, WS_PORT)

    try:

        await loop()

    finally:

        ws_server.close()

        await ws_server.wait_closed()


if __name__ == "__main__":

    asyncio.run(main())
