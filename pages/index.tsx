import type { NextPage } from "next";
import Head from "next/head";
import { useEffect, useReducer, useRef, useState } from "react";
import {
  Button,
  Checkbox,
  Container,
  Progress,
  Spacer,
} from "@nextui-org/react";
import Convert from "ansi-to-html";
import React from "react";
import { IFlashProgress } from "web-esptool/build/src/esptool/ESPLoader";
import { useSerialPortWithEsptool } from "../hooks/useSerialPortWithEsptool";
import { PartitionTable } from "../components/PartitionTable";

interface State {
  logBuffer: Uint8Array;
  logHtmls: string[];
}

type Action =
  | {
      type: "APPEND_LOG";
      logBuffer: Uint8Array;
    }
  | { type: "CLEAR_LOG" };

const reducer = (state: State, action: Action): State => {
  switch (action.type) {
    case "APPEND_LOG": {
      const decoder = new TextDecoder();

      let logBuffer = new Uint8Array([...state.logBuffer, ...action.logBuffer]);
      const logHtmls = [...state.logHtmls];

      while (true) {
        const lnIndex = logBuffer.indexOf(10);

        if (lnIndex === -1) {
          return {
            ...state,
            logBuffer,
            logHtmls,
          };
        } else {
          const current = logBuffer.slice(0, lnIndex);
          const remains = logBuffer.slice(lnIndex + 1);
          const logHtml = new Convert().toHtml(decoder.decode(current));

          logBuffer = remains;
          logHtmls.push(logHtml);
        }
      }
    }
    case "CLEAR_LOG": {
      return { ...state, logBuffer: new Uint8Array(), logHtmls: [] };
    }
  }
};

const Home: NextPage = () => {
  const [{ logHtmls }, dispatch] = useReducer(reducer, {
    logBuffer: new Uint8Array(),
    logHtmls: [],
  });
  const [fileHandle, setFileHandle] = useState<FileSystemFileHandle>();
  const [fileLastModified, setFileLastModified] = useState<number>();
  const [flashProgress, setFlashProgress] = useState<number>();
  const [autoScroll, setAutoScroll] = useState(true);
  const logContainerRef = useRef<HTMLDivElement>(null);

  const {
    connect,
    disconnect,
    reset,
    connected,
    chipDescription,
    withEsptool,
  } = useSerialPortWithEsptool({
    onData: (data) => {
      dispatch({ type: "APPEND_LOG", logBuffer: data });
    },
  });

  const handleFlash = async () => {
    if (fileHandle && connected) {
      setFlashProgress(0);
      await withEsptool(async (esptool) => {
        esptool.on(
          "progress",
          ({ blocks_written, blocks_total }: IFlashProgress) => {
            setFlashProgress((blocks_written / blocks_total) * 100);
          }
        );
        const file = await fileHandle.getFile();
        await esptool.flash({
          partitions: [
            { address: 0x10000, image: Buffer.from(await file.arrayBuffer()) },
          ],
        });
      });
      setFlashProgress(undefined);
    }
  };

  useEffect(() => {
    if (autoScroll) {
      logContainerRef.current?.lastElementChild?.scrollIntoView({
        behavior: "smooth",
      });
    }
  }, [logHtmls.length, autoScroll]);

  useEffect(() => {
    if (fileHandle) {
      const check = async () => {
        setFileLastModified((await fileHandle?.getFile())?.lastModified);
      };

      check();

      const timer = setInterval(check, 5000);

      return () => {
        clearInterval(timer);
      };
    }
  }, [fileHandle]);

  return (
    <div>
      <Head>
        <title>Web ESP32 Writer</title>
        <meta name="description" content="Web ESP32 Writer" />
        <link rel="icon" href="/favicon.ico" />
      </Head>

      <main>
        <Container>
          {chipDescription}
          <Button.Group>
            {!connected && <Button onClick={connect}>Connect</Button>}
            {connected && <Button onClick={disconnect}>Disconnect</Button>}
            <Button disabled={!connected} onClick={reset}>
              Reset
            </Button>
            <Button
              disabled={logHtmls.length === 0}
              onClick={() => dispatch({ type: "CLEAR_LOG" })}
            >
              Clear log
            </Button>
          </Button.Group>

          <Checkbox isSelected={autoScroll} onChange={setAutoScroll}>
            Auto scroll
          </Checkbox>

          <Spacer />

          {connected && (
            <>
              <PartitionTable withEsptool={withEsptool} />
              <Spacer />
            </>
          )}

          {fileHandle?.name}
          {fileLastModified && (
            <>({new Date(fileLastModified).toLocaleString()})</>
          )}

          <Button.Group>
            <Button
              onClick={async () => {
                const [fileHandle] = await window.showOpenFilePicker({
                  multiple: false,
                });
                setFileHandle(fileHandle);
              }}
            >
              Open image
            </Button>
            <Button
              disabled={!fileHandle || flashProgress !== undefined}
              onClick={handleFlash}
            >
              Flash
            </Button>
          </Button.Group>
          {flashProgress !== undefined && (
            <Progress color="primary" value={flashProgress} />
          )}

          <Spacer />

          <div
            ref={logContainerRef}
            style={{
              display: "flex",
              flexDirection: "column",
              flexWrap: "nowrap",
              maxHeight: "50vh",
              overflowY: "auto",
            }}
          >
            {logHtmls.map((html, i) => (
              <span key={i} dangerouslySetInnerHTML={{ __html: html }} />
            ))}
          </div>
        </Container>
      </main>
    </div>
  );
};

export default Home;
