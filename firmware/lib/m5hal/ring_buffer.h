#pragma once

#include <cstddef>
#include <cstdint>

namespace m5hal {

template <std::size_t N>
class ByteRingBuffer {
public:
    std::size_t write(const uint8_t* data, std::size_t len) {
        std::size_t written = 0;
        while (written < len && size_ < N) {
            buf_[head_] = data[written++];
            head_ = (head_ + 1) % N;
            size_++;
        }
        return written;
    }

    std::size_t read(uint8_t* out, std::size_t len) {
        std::size_t got = 0;
        while (got < len && size_ > 0) {
            out[got++] = buf_[tail_];
            tail_ = (tail_ + 1) % N;
            size_--;
        }
        return got;
    }

    std::size_t available() const { return size_; }

    void clear() {
        head_ = 0;
        tail_ = 0;
        size_ = 0;
    }

private:
    uint8_t     buf_[N]{};
    std::size_t head_ = 0;
    std::size_t tail_ = 0;
    std::size_t size_ = 0;
};

}  // namespace m5hal
