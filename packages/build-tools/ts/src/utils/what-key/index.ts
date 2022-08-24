// Script that prints out the keys you pressed
export {};

process.stdin.setRawMode(true);

const processInput = (chunk: Buffer) => {
  let input = String(chunk);
  const key = {
    // ctrl, shift, none
    upArrow: ['\u001b[1;5A', '\u001b[1;2A', '\u001b[A', '\u001bOA'].includes(
      input
    ),
    downArrow: ['\u001b[1;5B', '\u001b[1;2B', '\u001b[B', '\u001bOB'].includes(
      input
    ),
    leftArrow: ['\u001b[1;5D', '\u001b[1;2D', '\u001b[D', '\u001bOD'].includes(
      input
    ),
    rightArrow: ['\u001b[1;5C', '\u001b[1;2C', '\u001b[C', '\u001bOC'].includes(
      input
    ),
    //
    return: input === '\r',
    escape: input === '\u001b',
    backspace: input === '\b',
    delete: input === '\u007f',
    //
    pageUp: input === '\u001b[5~',
    pageDown: input === '\u001b[6~',
    home: input === '\u001b[H',
    end: input === '\u001b[F',
    //
    ctrl: false,
    shift: false,
    meta: false,
  };
  if (input.includes('\u001b[1;2')) {
    key.shift = true;
  }
  if (input.includes('\u001b[1;5')) {
    key.ctrl = true;
  }

  if (input <= '\u001a' && !key.return && !key.backspace) {
    const next = String.fromCharCode(
      input.charCodeAt(0) + 'a'.charCodeAt(0) - 1
    );
    input = next;
    key.ctrl = true;
    key.shift =
      (input >= 'A' && input <= 'Z') || (input >= 'А' && input <= 'Я');
    key.meta = true;
  }

  if (input.startsWith('\u001b')) {
    input = input.slice(1);
    key.meta = true;
  }

  // clear screen and move to home:
  console.log('\u001b[2J\u001b[H');
  console.log({
    hex: Buffer.from(chunk).toString('hex'),
    printable: String(chunk),
    numBytes: chunk.byteLength,
  });
  console.log(key);

  if (key.ctrl && input.toUpperCase() === 'C') {
    process.stdin.removeAllListeners();
    process.exitCode = 0;
    process.stdout.end();
    return;
  }
};

process.stdin.addListener('data', processInput);
