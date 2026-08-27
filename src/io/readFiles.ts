/**
 * File → parsed JSON. Everything stays in the browser: no upload, no network,
 * no persistence. Reading a file is the only I/O this application performs.
 */

export interface ReadResult {
  fileName: string;
  raw: unknown;
  parseError?: string;
}

export async function readFiles(files: FileList | File[]): Promise<ReadResult[]> {
  const list = Array.from(files).filter((f) => /\.json$/i.test(f.name) || f.type === 'application/json');
  return Promise.all(
    list.map(async (file) => {
      const text = await file.text();
      try {
        return { fileName: file.name, raw: JSON.parse(text) as unknown };
      } catch (e) {
        return { fileName: file.name, raw: null, parseError: (e as Error).message };
      }
    }),
  );
}

/** Opens the OS picker. Multiple selection so a compare is one interaction. */
export function pickFiles(): Promise<ReadResult[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.multiple = true;
    input.onchange = () => {
      if (!input.files?.length) return resolve([]);
      void readFiles(input.files).then(resolve);
    };
    input.click();
  });
}
