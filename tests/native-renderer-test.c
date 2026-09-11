#include <assert.h>

/* Include the implementation so the tessellation policy can be checked
   without making the narrow native bridge API any wider. */
#define main ao_native_main
#include "../native/ao-native.c"
#undef main

int main(void) {
  assert(fan_steps(1.0f) == 64);
  assert(fan_steps(100.0f) > 64);
  assert(fan_steps(10000.0f) == 512);
  return 0;
}
