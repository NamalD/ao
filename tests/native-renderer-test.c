#include <assert.h>

/* Include the implementation so the tessellation policy can be checked
   without making the narrow native bridge API any wider. */
#define main ao_native_main
#include "../native/ao-native.c"
#undef main

/* Render a dark vertical gradient spanning four 8-bit levels.  Without
   dithering every row is flat and changes in hard bands; with it, rows mix
   neighbouring levels while keeping the gradient's average brightness. */
static void check_dark_gradient_is_dithered(void) {
  if (!SDL_Init(SDL_INIT_VIDEO)) { fprintf(stderr, "skip dither test: %s\n", SDL_GetError()); return; }
  SDL_Window *window = SDL_CreateWindow("ao-test", 64, 64, SDL_WINDOW_HIDDEN);
  SDL_GPUDevice *gpu = window ? SDL_CreateGPUDevice(SDL_GPU_SHADERFORMAT_SPIRV, false, "vulkan") : NULL;
  SDL_Renderer *renderer = NULL;
  if (gpu) {
    SDL_PropertiesID props = SDL_CreateProperties();
    SDL_SetPointerProperty(props, SDL_PROP_RENDERER_CREATE_WINDOW_POINTER, window);
    SDL_SetPointerProperty(props, SDL_PROP_RENDERER_CREATE_GPU_DEVICE_POINTER, gpu);
    SDL_SetStringProperty(props, SDL_PROP_RENDERER_CREATE_NAME_STRING, "gpu");
    renderer = SDL_CreateRendererWithProperties(props); SDL_DestroyProperties(props);
  }
  if (!renderer) { fprintf(stderr, "skip dither test: %s\n", SDL_GetError()); SDL_Quit(); return; }

  enum { W = 64, H = 256 };
  SDL_Texture *output = SDL_CreateTexture(renderer, SDL_PIXELFORMAT_RGBA32, SDL_TEXTUREACCESS_TARGET, W, H);
  assert(output);
  clear_r = clear_g = clear_b = 0; clear_a = 255;
  command_count = 1;
  commands[0] = (Command){ .type = CMD_RECT, .x1 = 0, .y1 = 0, .x2 = W, .y2 = H,
                           .r = 0, .g = 0, .b = 0, .a = 255, .r2 = 3, .g2 = 3, .b2 = 3, .a2 = 255,
                           .blend = SDL_BLENDMODE_BLEND };
  draw_scene(renderer, output);
  SDL_SetRenderTarget(renderer, output);
  SDL_Surface *pixels = SDL_RenderReadPixels(renderer, NULL);
  assert(pixels);
  SDL_Surface *rgba = SDL_ConvertSurface(pixels, SDL_PIXELFORMAT_RGBA32);
  assert(rgba);

  int mixed_rows = 0;
  for (int y = 0; y < H; y++) {
    const Uint8 *row = (const Uint8 *)rgba->pixels + y * rgba->pitch;
    int lo = 255, hi = 0; double sum = 0;
    for (int x = 0; x < W; x++) {
      int g = row[x * 4 + 1];
      if (g < lo) lo = g;
      if (g > hi) hi = g;
      sum += g;
    }
    if (hi > lo) mixed_rows++;
    double expected = 3.0 * (y + .5) / H;
    assert(fabs(sum / W - expected) < .35);
  }
  assert(mixed_rows > H * 3 / 4);

  SDL_DestroySurface(rgba); SDL_DestroySurface(pixels);
  SDL_DestroyTexture(output);
  if (scene_layer) SDL_DestroyTexture(scene_layer);
  if (dither_tile) SDL_DestroyTexture(dither_tile);
  scene_layer = dither_tile = NULL;
  SDL_DestroyRenderer(renderer); SDL_DestroyGPUDevice(gpu); SDL_DestroyWindow(window); SDL_Quit();
}

int main(void) {
  for (int y = 0; y < DITHER_SIZE; y++)
    for (int x = 0; x < DITHER_SIZE; x++) {
      float v = dither_noise(x, y);
      assert(v >= 0.0f && v < 1.0f);
    }
  check_dark_gradient_is_dithered();
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
