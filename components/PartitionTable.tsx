import { Button, Dropdown, Input, Grid, Progress } from "@nextui-org/react";
import React, { useState } from "react";
import { useEffect, useReducer } from "react";
import ESPTool from "web-esptool";
import { IFlashProgress } from "web-esptool/build/src/esptool/ESPLoader";
import {
  loadPartitions,
  Partition,
  SUBTYPES,
  TYPES,
  writePartitions,
} from "../utils/partition";

interface State {
  originalPartitions: Partition[];
  currentPartitions: Partition[];
}

type Action =
  | {
      type: "INIT_PARTITIONS";
      partitions: Partition[];
    }
  | {
      type: "DELETE_PARTITION";
      row: number;
    }
  | {
      type: "ADD_PARTITION";
      partition: Partition;
    }
  | {
      type: "UPDATE_PARTITION";
      partition: Partition;
      row: number;
    };

const reducer = (state: State, action: Action): State => {
  switch (action.type) {
    case "INIT_PARTITIONS": {
      return {
        ...state,
        originalPartitions: action.partitions,
        currentPartitions: action.partitions,
      };
    }
    case "DELETE_PARTITION": {
      return {
        ...state,
        currentPartitions: state.currentPartitions.filter(
          (_, i) => i !== action.row
        ),
      };
    }
    case "ADD_PARTITION": {
      return {
        ...state,
        currentPartitions: [...state.currentPartitions, action.partition],
      };
    }
    case "UPDATE_PARTITION": {
      const currentPartitions = [...state.currentPartitions];
      currentPartitions[action.row] = action.partition;

      return {
        ...state,
        currentPartitions,
      };
    }
  }
};

const initialState: State = {
  currentPartitions: [],
  originalPartitions: [],
};

export const PartitionTable: React.FC<{
  withEsptool: (callback: (esptool: ESPTool) => Promise<void>) => Promise<void>;
}> = React.memo(({ withEsptool }) => {
  const [{ currentPartitions }, dispatch] = useReducer(reducer, initialState);

  const [flashProgress, setFlashProgress] = useState<number>();

  const handleReload = async () => {
    await withEsptool(async (esptool) => {
      const partitions = (await loadPartitions(esptool)) ?? [];
      dispatch({ type: "INIT_PARTITIONS", partitions });
    });
  };

  const handleFlash = async () => {
    setFlashProgress(0);
    await withEsptool(async (esptool) => {
      esptool.on(
        "progress",
        ({ blocks_written, blocks_total }: IFlashProgress) => {
          setFlashProgress((blocks_written / blocks_total) * 100);
        }
      );
      await writePartitions(esptool, currentPartitions);
      setFlashProgress(undefined);
    });
  };

  useEffect(() => {
    handleReload();
  }, []);

  return (
    <>
      <Grid.Container>
        <Grid xs={2}>Type</Grid>
        <Grid xs={2}>Subtype</Grid>
        <Grid xs={2}>Offset</Grid>
        <Grid xs={2}>Size</Grid>
        <Grid xs={2}>Name</Grid>
        <Grid xs={2}>Actions</Grid>
      </Grid.Container>

      {currentPartitions.map((p, i) => (
        <Grid.Container key={i}>
          <Grid xs={2}>
            <Dropdown>
              <Dropdown.Button flat>{p.type}</Dropdown.Button>
              <Dropdown.Menu
                aria-label="Type"
                selectionMode="single"
                onSelectionChange={(v) => {
                  const type = Array.from(v)[0] as keyof typeof TYPES;
                  if (p.type !== type) {
                    const subtype = Object.keys(SUBTYPES[type])[0];
                    dispatch({
                      type: "UPDATE_PARTITION",
                      partition: { ...p, type, subtype },
                      row: i,
                    });
                  }
                }}
              >
                {Object.keys(TYPES).map((t) => (
                  <Dropdown.Item key={t}>{t}</Dropdown.Item>
                ))}
              </Dropdown.Menu>
            </Dropdown>
          </Grid>
          <Grid xs={2}>
            <Dropdown>
              <Dropdown.Button flat>{p.subtype}</Dropdown.Button>
              <Dropdown.Menu
                aria-label="Subtype"
                selectionMode="single"
                onSelectionChange={(v) => {
                  const subtype = Array.from(v)[0] as string;
                  dispatch({
                    type: "UPDATE_PARTITION",
                    partition: { ...p, subtype },
                    row: i,
                  });
                }}
              >
                {Object.keys(SUBTYPES[p.type]).map((t) => (
                  <Dropdown.Item key={t}>{t}</Dropdown.Item>
                ))}
              </Dropdown.Menu>
            </Dropdown>
          </Grid>
          <Grid xs={2}>
            0x
            <Input
              value={p.offset.toString(16)}
              onChange={(v) => {
                const offset = parseInt(v.currentTarget.value, 16);

                dispatch({
                  type: "UPDATE_PARTITION",
                  partition: { ...p, offset },
                  row: i,
                });
              }}
            />
          </Grid>
          <Grid xs={2}>
            0x
            <Input
              type="text"
              value={p.size.toString(16)}
              onChange={(v) => {
                const size = parseInt(v.currentTarget.value, 16);

                dispatch({
                  type: "UPDATE_PARTITION",
                  partition: { ...p, size },
                  row: i,
                });
              }}
            />
          </Grid>
          <Grid xs={2}>
            <Input
              value={p.name}
              onChange={(v) => {
                const name = v.currentTarget.value;

                dispatch({
                  type: "UPDATE_PARTITION",
                  partition: { ...p, name },
                  row: i,
                });
              }}
            />
          </Grid>
          <Grid xs={2}>
            <Button
              onClick={() => {
                dispatch({ type: "DELETE_PARTITION", row: i });
              }}
              size="xs"
            >
              Delete
            </Button>
          </Grid>
        </Grid.Container>
      ))}

      <Button.Group>
        <Button
          onClick={() => {
            const lastPartition =
              currentPartitions[currentPartitions.length - 1];

            dispatch({
              type: "ADD_PARTITION",
              partition: {
                type: "data",
                subtype: "nvs",
                offset: lastPartition.offset + lastPartition.size,
                size: 0x1000,
                name: "new",
              },
            });
          }}
        >
          Add
        </Button>
        <Button disabled={flashProgress !== undefined} onClick={handleFlash}>
          Flash
        </Button>
        <Button onClick={handleReload}>Reload</Button>
      </Button.Group>

      {flashProgress !== undefined && (
        <Progress color="primary" value={flashProgress} />
      )}
    </>
  );
});
