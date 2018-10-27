// This code has been ported almost directly from Go's src/bytes/buffer.go
// Copyright 2009 The Go Authors. All rights reserved. BSD license.
// https://github.com/golang/go/blob/master/LICENSE

//import * as io from "./io";
import { Reader, Writer, ReadResult } from "./io";
//import { notImplemented } from "./util";
import { TypedArray } from "./types";

// MIN_READ is the minimum ArrayBuffer size passed to a read call by
// buffer.ReadFrom. As long as the Buffer has at least MIN_READ bytes beyond
// what is required to hold the contents of r, readFrom will not grow the
// underlying buffer.
const MIN_READ = 512;

// `off` is the offset into `dst` where it will at which to begin writing values
// from `src`.
// Returns the number of bytes copied.
function copyBytes(dst: TypedArray, src: TypedArray, off = 0): number {
  const r = dst.byteLength - off;
  if (src.byteLength > r) {
    src = src.subarray(0, r);
  }
  dst.set(src, off);
  return src.byteLength;
}

/** A Buffer is a variable-sized buffer of bytes with read() and write()
 * methods. Based on https://golang.org/pkg/bytes/#Buffer
 */
export class Buffer implements Reader, Writer {
  off = 0;
  private buf: Uint8Array;

  constructor(buf?: Uint8Array) {
    this.buf = buf != null ? buf : new Uint8Array();
  }

  /** length is a getter that returns the number of bytes of the unread
   * portion of the buffer
   */
  get length() {
    return this.buf.byteLength - this.off;
  }

  /** bytes() returns a slice holding the unread portion of the buffer.
   * The slice is valid for use only until the next buffer modification (that
   * is, only until the next call to a method like read(), write(), reset(), or
   * truncate()). The slice aliases the buffer content at least until the next
   * buffer modification, so immediate changes to the slice will affect the
   * result of future reads.
   */
  bytes(): Uint8Array {
    return this.buf.subarray(this.off);
  }

  /** empty() returns whether the unread portion of the buffer is empty. */
  empty() {
    return this.buf.byteLength <= this.off;
  }

  /** reset() resets the buffer to be empty, but it retains the underlying
   * storage for use by future writes. reset() is the same as truncate(0)
   */
  reset() {
    this.buf = this.buf.subarray(0, 0);
    this.off = 0;
  }

  /** truncate() discards all but the first n unread bytes from the buffer but
   * continues to use the same allocated storage.  It throws if n is negative or
   * greater than the length of the buffer.
   */
  truncate(n: number): void {
    if (n === 0) {
      this.reset();
      return;
    }
    if (n < 0 || n > this.length) {
      throw Error("bytes.Buffer: truncation out of range");
    }
    this.buf = this.buf.subarray(0, this.off + n);
  }

  /** read() reads the next len(p) bytes from the buffer or until the buffer
   * is drained. The return value n is the number of bytes read. If the
   * buffer has no data to return, eof in the response will be true.
   */
  async read(p: ArrayBufferView): Promise<ReadResult> {
    if (this.empty()) {
      // Buffer is empty, reset to recover space.
      this.reset();
      if (p.byteLength === 0) {
        return { nread: 0, eof: false };
      }
      return { nread: 0, eof: true };
    }
    const nread = copyBytes(p as TypedArray, this.buf.subarray(this.off));
    this.off += nread;
    return { nread, eof: false };
  }

  async write(p: ArrayBufferView): Promise<number> {
    const m = this._grow(p.byteLength);
    return copyBytes(this.buf, p as TypedArray, m);
  }

  /** grow() grows the buffer's capacity, if necessary, to guarantee space for
   * another n bytes. After grow(n), at least n bytes can be written to the
   * buffer without another allocation. If n is negative, grow() will panic. If
   * the buffer can't grow it will throw ErrTooLarge.
   * Based on https://golang.org/pkg/bytes/#Buffer.Grow
   */
  grow(n: number): void {
    if (n < 0) {
      throw Error("Buffer.grow: negative count");
    }
    const m = this._grow(n);
    this.buf = this.buf.subarray(0, m);
  }

  // _grow() grows the buffer to guarantee space for n more bytes.
  // It returns the index where bytes should be written.
  // If the buffer can't grow it will panic with ErrTooLarge.
  private _grow(n: number): number {
    let m = this.length;
    // If buffer is empty, reset to recover space.
    if (m === 0 && this.off !== 0) {
      this.reset();
    }
    let c = this.buf.byteLength;
    if (n <= c / 2 - m) {
      // We can slide things down instead of allocating a new
      // ArrayBuffer. We only need m+n <= c to slide, but
      // we instead let capacity get twice as large so we
      // don't spend all our time copying.
      this.buf.copyWithin(0, this.off);
      // copy(this.buf, this.buf[this.off:])
    } else if (c > Number.MAX_SAFE_INTEGER - c - n) {
      throw Error("ErrTooLarge"); // TODO DenoError(TooLarge)
    } else {
      // Not enough space anywhere, we need to allocate.
      const buf = new Uint8Array(2 * c + n);
      // Copy
      for (let i = this.off; i < this.buf.byteLength; i++) {
        buf[i - this.off] = this.buf[i];
      }
      this.buf = buf;
    }
    // Restore this.off and len(this.buf).
    this.off = 0;
    this.buf = this.buf.subarray(0, m + n);
    return m;
  }

  /** readFrom() reads data from r until EOF and appends it to the buffer, growing
   * the buffer as needed. It returns the number of bytes read.  If the
   * buffer becomes too large, readFrom will panic with ErrTooLarge.
   * Based on https://golang.org/pkg/bytes/#Buffer.ReadFrom
   */
  async readFrom(r: Reader): Promise<number> {
    let n = 0;
    while (true) {
      try {
        let i = this._grow(MIN_READ);
        this.buf = this.buf.subarray(0, i);

        const result = await r.read(this.buf.subarray(i, cap(this.buf)));
        const m = result.nread;

        this.buf = this.buf.subarray(0, i + m);
        n += m;
        if (result.eof) {
          return n;
        }
      } catch (e) {
        return n;
      }
    }
  }
}

function cap(a: TypedArray): number {
  return a.byteLength;
}
