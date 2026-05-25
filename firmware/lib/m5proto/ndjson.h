#pragma once

#include <cstddef>
#include <cstdint>
#include <cstring>

namespace m5proto {

// NDJSON line framer. Buffers byte chunks and invokes `onLine(ptr, len)` for
// every complete line (without trailing '\n'). Empty lines are skipped. Lines
// longer than `max_len` are dropped (and a resync flag is set so the next '\n'
// recovers framing).
class NdjsonFramer {
public:
    explicit NdjsonFramer(std::size_t max_len = 3072)
        : max_len_(max_len), len_(0), overflow_(false) {}

    template <typename OnLine>
    void push(const uint8_t* data, std::size_t n, OnLine onLine) {
        for (std::size_t i = 0; i < n; ++i) {
            const char c = static_cast<char>(data[i]);
            if (c == '\n') {
                if (overflow_) {
                    overflow_ = false;
                    len_ = 0;
                    continue;
                }
                if (len_ > 0) {
                    onLine(buf_, len_);
                }
                len_ = 0;
                continue;
            }
            if (overflow_) continue;
            if (len_ + 1 >= max_len_) {
                overflow_ = true;
                len_ = 0;
                continue;
            }
            buf_[len_++] = c;
            buf_[len_]   = '\0';
        }
    }

    template <typename OnByte>
    static void frame(const char* line, OnByte onByte) {
        const std::size_t n = std::strlen(line);
        onByte(line, n);
        const char nl = '\n';
        onByte(&nl, 1);
    }

private:
    static constexpr std::size_t kStaticBufBytes = 4096;
    char buf_[kStaticBufBytes];
    std::size_t max_len_;
    std::size_t len_;
    bool overflow_;
};

}  // namespace m5proto
