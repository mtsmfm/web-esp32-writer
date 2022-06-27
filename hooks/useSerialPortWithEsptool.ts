import { useCallback, useRef, useState } from "react";
import ESPTool from "web-esptool";
import { Mutex } from "async-mutex";

const mutex = new Mutex();

export const useSerialPortWithEsptool = ({
  onData,
}: {
  onData: (data: Uint8Array) => void;
}) => {
  const [port, setPort] = useState<SerialPort>();
  const [chipDescription, setChipDescription] = useState<string>();
  const readerRef = useRef<ReadableStreamDefaultReader<Uint8Array>>();

  const internalWithEsptool = async (
    port: SerialPort,
    callback: (esptool: ESPTool) => Promise<void>
  ) => {
    if (readerRef.current) {
      await readerRef.current.cancel();
      readerRef.current.releaseLock();
    }

    await port.close();

    const esptool = new ESPTool();
    await esptool.open(port);

    await callback(esptool);

    await esptool.close();

    await port.open({ baudRate: 921600 });

    const reader = port.readable?.getReader();

    if (reader) {
      readerRef.current = reader;

      (async () => {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }
          if (value) {
            onData(value);
          }
        }
      })();
    }
  };

  const connect = async () => {
    const port = await navigator.serial.requestPort();

    await port.open({ baudRate: 921600 });

    await internalWithEsptool(port, async (esptool) => {
      setChipDescription(await esptool.loader!.get_chip_description());
    });

    setPort(port);
  };

  const disconnect = async () => {
    if (readerRef.current) {
      await readerRef.current.cancel();
      readerRef.current.releaseLock();
      readerRef.current = undefined;
    }

    if (port) {
      await port.close();
      setPort(undefined);
    }

    setChipDescription(undefined);
  };

  const reset = async () => {
    if (port) {
      await internalWithEsptool(port, async (esptool) => {
        await esptool.loader?.hard_reset();
      });
    }
  };

  const withEsptool = useCallback(
    async (callback: (esptool: ESPTool) => Promise<void>) => {
      await mutex.runExclusive(async () => {
        if (port) {
          await internalWithEsptool(port, callback);
        }
      });
    },
    [port]
  );

  return {
    connected: !!port,
    connect,
    disconnect,
    reset,
    chipDescription,
    withEsptool,
  };
};
