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
  SDL_FPoint far_center, near_center; float far_radius, near_radius;
  assert(project_sphere(0.0f, 0.0f, 0.0f, .1f, 1000, 500,
                        &far_center, &far_radius));
  assert(project_sphere(0.0f, 0.0f, 1.0f, .1f, 1000, 500,
                        &near_center, &near_radius));
  assert(far_center.x == near_center.x && far_center.y == near_center.y);
  assert(near_radius > far_radius);
  assert(!project_sphere(0.0f, 0.0f, 2.0f, .1f, 1000, 500,
                         &far_center, &far_radius));
  return 0;
}
