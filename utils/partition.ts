import { createHash } from "crypto";
import ESPTool from "web-esptool";

const PARTITION_TABLE_OFFSET = 0x8000;
const MAX_PARTITION_LENGTH = 0xc00;
const MD5_PARTITION_BEGIN = [
  0xeb,
  0xeb,
  ...(Array.from({ length: 14 }).fill(0xff) as number[]),
];

const MAGIC_BYTES = [0xaa, 0x50];

const PER_PARTITION_BYTES = 32;

export const TYPES = {
  app: 0x00,
  data: 0x01,
};

export const SUBTYPES: { [k: string]: { [k: string]: number } } = {
  app: {
    factory: 0x00,
    test: 0x20,
    ...(Array.from({ length: 16 }) as number[]).reduce(
      (acc, _, i) => ({ ...acc, [`ota_${i}`]: 0x10 + i }),
      {}
    ),
  },
  data: {
    ota: 0x00,
    phy: 0x01,
    nvs: 0x02,
    coredump: 0x03,
    nvs_keys: 0x04,
    efuse: 0x05,
    esphttpd: 0x80,
    fat: 0x81,
    spiffs: 0x82,
  },
};

type KeysOfUnion<T> = T extends T ? keyof T : never;

export interface Partition {
  type: keyof typeof TYPES;
  subtype: KeysOfUnion<typeof SUBTYPES["app"] | typeof SUBTYPES["data"]>;
  offset: number;
  size: number;
  name: string;
}

const findKeyByValue = <T>(
  obj: T,
  value: T[KeysOfUnion<T>]
): KeysOfUnion<T> | undefined => {
  const key = Object.keys(obj).find((k) => obj[k as keyof T] === value);

  return key as KeysOfUnion<T>;
};

export const loadPartitions = async (esptool: ESPTool) => {
  const result = await esptool.loader?.read_flash(
    PARTITION_TABLE_OFFSET,
    MAX_PARTITION_LENGTH
  );

  if (!result) {
    return;
  }

  return deserializePartitions(result);
};

export const writePartitions = async (
  esptool: ESPTool,
  partitions: Partition[]
) => {
  await esptool.flash({
    partitions: [
      {
        address: PARTITION_TABLE_OFFSET,
        image: serializePartitions(partitions),
      },
    ],
  });
};

const deserializePartitions = (data: Buffer) => {
  const partitions: Partition[] = [];

  const md5 = createHash("md5");

  for (
    let currentIndex = 0;
    currentIndex + PER_PARTITION_BYTES < data.length;
    currentIndex += PER_PARTITION_BYTES
  ) {
    let currentData = data.subarray(
      currentIndex,
      currentIndex + PER_PARTITION_BYTES
    );

    if (currentData.every((d) => d === 0xff)) {
      break;
    }

    if (
      currentData
        .subarray(0, MD5_PARTITION_BEGIN.length)
        .equals(Buffer.from(MD5_PARTITION_BEGIN))
    ) {
      const result = md5.digest();
      if (result.compare(currentData.subarray(16)) !== 0) {
        throw "partition is broken";
      }
      break;
    }

    md5.update(currentData);

    const _magic = [currentData.readUInt8(0), currentData.readUInt8(1)];
    const type = findKeyByValue(TYPES, currentData.readUInt8(2))!;
    const subtype = findKeyByValue(SUBTYPES[type], currentData.readUInt8(3))!;
    const offset = currentData.readUInt32LE(4);
    const size = currentData.readUInt32LE(8);
    const name = currentData.subarray(12, 28).toString().replace(/\0/g, "");
    partitions.push({ type, subtype, offset, size, name });
  }

  return partitions;
};

const serializePartitions = (partitions: Partition[]): Buffer => {
  const md5 = createHash("md5");
  const allBuffer = Buffer.alloc(MAX_PARTITION_LENGTH, 0xff);

  let currentIndex = 0;

  partitions.forEach((p) => {
    const buffer = Buffer.alloc(PER_PARTITION_BYTES);
    buffer.writeUInt8(MAGIC_BYTES[0], 0);
    buffer.writeUInt8(MAGIC_BYTES[1], 1);
    buffer.writeUInt8(TYPES[p.type], 2);
    buffer.writeUInt8(SUBTYPES[p.type][p.subtype], 3);
    buffer.writeUInt32LE(p.offset, 4);
    buffer.writeUInt32LE(p.size, 8);
    const nameBuffer = Buffer.from(p.name);

    Array.from({ length: Math.max(nameBuffer.length, 16) }).forEach((_, i) => {
      buffer.writeUInt8(nameBuffer[i], 12 + i);
    });

    md5.update(buffer);

    buffer.forEach((b) => {
      allBuffer[currentIndex++] = b;
    });
  });

  MD5_PARTITION_BEGIN.forEach((b) => (allBuffer[currentIndex++] = b));
  md5.digest().forEach((b) => (allBuffer[currentIndex++] = b));

  return allBuffer;
};
