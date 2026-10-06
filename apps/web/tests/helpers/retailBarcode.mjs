// Independent standard EAN fixture encoder used only by tests; the app has no seeded products.
const L = ['0001101','0011001','0010011','0111101','0100011','0110001','0101111','0111011','0110111','0001011'];
const G = ['0100111','0110011','0011011','0100001','0011101','0111001','0000101','0010001','0001001','0010111'];
const parity = ['LLLLLL','LLGLGG','LLGGLG','LLGGGL','LGLLGG','LGGLLG','LGGGLL','LGLGLG','LGLGGL','LGGLGL'];
export function retailBarcode(value, moduleWidth = 5) {
  const left = value.length === 13 ? value.slice(1, 7).split('').map((digit, i) => (parity[Number(value[0])][i] === 'L' ? L : G)[Number(digit)]).join('') : value.slice(0, 4).split('').map((digit) => L[Number(digit)]).join('');
  const right = (value.length === 13 ? value.slice(7) : value.slice(4)).split('').map((digit) => L[Number(digit)].replace(/[01]/g, (bit) => bit === '0' ? '1' : '0')).join('');
  const bits = `101${left}01010${right}101`;
  const margin = moduleWidth * 15; const width = bits.length * moduleWidth + margin * 2; const height = 240;
  const rgba = new Uint8ClampedArray(width * height * 4).fill(255);
  for (let y = 30; y < 190; y++) for (let module = 0; module < bits.length; module++) if (bits[module] === '1') for (let i = 0; i < moduleWidth; i++) {
    const offset = (y * width + margin + module * moduleWidth + i) * 4;
    rgba[offset] = rgba[offset + 1] = rgba[offset + 2] = 0;
  }
  return { rgba, width, height, barWidth: bits.length * moduleWidth };
}
