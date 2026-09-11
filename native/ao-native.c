#include <SDL3/SDL.h>
#include <SDL3/SDL_gpu.h>
#include <fcntl.h>
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

#ifndef M_PI
#define M_PI 3.14159265358979323846
#endif

#define MAX_COMMANDS 8192
#define MAX_POINTS 256

typedef enum { CMD_RECT, CMD_CIRCLE, CMD_LINE, CMD_POLYLINE } CommandType;
typedef struct { CommandType type; float x1,y1,x2,y2,radius,width; Uint8 r,g,b,a, r2,g2,b2,a2; SDL_BlendMode blend; int count; SDL_FPoint points[MAX_POINTS]; } Command;
static Command commands[MAX_COMMANDS];
static int command_count = 0;
static Uint8 clear_r = 2, clear_g = 2, clear_b = 8, clear_a = 255;
static bool show_help = false;
static bool show_fps = false;
static Uint64 fps_window_start = 0;
static unsigned fps_frames = 0;
static float fps_value = 0.0f;
static char status_text[384] = {0};
static Uint64 status_until = 0;
static SDL_BlendMode active_blend = SDL_BLENDMODE_BLEND;
static SDL_Texture *scene_layer = NULL;
static int scene_width = 0, scene_height = 0;

static void report_size(SDL_Window *window) {
  int width = 0, height = 0;
  if (SDL_GetWindowSizeInPixels(window, &width, &height)) {
    printf("size %d %d\n", width, height);
    fflush(stdout);
  }
}

static SDL_FColor color(Uint8 r, Uint8 g, Uint8 b, Uint8 a) {
  return (SDL_FColor){r / 255.0f, g / 255.0f, b / 255.0f, a / 255.0f};
}

static void draw_fan(SDL_Renderer *renderer, float x, float y, float radius, SDL_FColor inner, SDL_FColor outer) {
  enum { STEPS = 64 };
  SDL_Vertex vertices[STEPS + 1]; int indices[STEPS * 3];
  vertices[0] = (SDL_Vertex){{x,y}, inner, {0,0}};
  for (int i = 0; i < STEPS; i++) {
    float angle = (float)i * 2.0f * (float)M_PI / STEPS;
    vertices[i+1] = (SDL_Vertex){{x + cosf(angle)*radius, y + sinf(angle)*radius}, outer, {0,0}};
    indices[i*3] = 0; indices[i*3+1] = i+1; indices[i*3+2] = (i+1) % STEPS + 1;
  }
  SDL_RenderGeometry(renderer, NULL, vertices, STEPS + 1, indices, STEPS * 3);
}

static void draw_circle(SDL_Renderer *renderer, const Command *c) {
  SDL_FColor inner = color(c->r,c->g,c->b,c->a);
  SDL_FColor outer = color(c->r2,c->g2,c->b2,c->a2);
  /* A large transparent radial pass is an inexpensive, resolution-independent bloom. */
  SDL_FColor glow = inner; glow.a *= 0.18f;
  draw_fan(renderer, c->x1, c->y1, c->radius * 2.7f, glow, (SDL_FColor){inner.r,inner.g,inner.b,0});
  draw_fan(renderer, c->x1, c->y1, c->radius, inner, outer);
}

static void draw_rect(SDL_Renderer *renderer, const Command *c) {
  SDL_FColor top=color(c->r,c->g,c->b,c->a), bottom=color(c->r2,c->g2,c->b2,c->a2);
  SDL_Vertex v[4] = {{{c->x1,c->y1},top,{0,0}},{{c->x1+c->x2,c->y1},top,{0,0}},{{c->x1+c->x2,c->y1+c->y2},bottom,{0,0}},{{c->x1,c->y1+c->y2},bottom,{0,0}}};
  int idx[] = {0,1,2,0,2,3}; SDL_RenderGeometry(renderer,NULL,v,4,idx,6);
}

static void draw_ribbon_segment(SDL_Renderer *renderer, float x1, float y1, float x2, float y2, float width, SDL_FColor c) {
  float dx=x2-x1, dy=y2-y1, length=sqrtf(dx*dx+dy*dy); if (length < .01f) return;
  float nx=-dy/length*width*.5f, ny=dx/length*width*.5f;
  SDL_Vertex v[4] = {{{x1+nx,y1+ny},c,{0,0}},{{x1-nx,y1-ny},c,{0,0}},{{x2-nx,y2-ny},c,{0,0}},{{x2+nx,y2+ny},c,{0,0}}};
  int idx[] = {0,1,2,0,2,3}; SDL_RenderGeometry(renderer,NULL,v,4,idx,6);
}

static SDL_Texture *ensure_scene_layer(SDL_Renderer *renderer) {
  int width = 0, height = 0;
  if (!SDL_GetRenderOutputSize(renderer, &width, &height) || width < 1 || height < 1) return NULL;
  if (scene_layer && width == scene_width && height == scene_height) return scene_layer;
  if (scene_layer) SDL_DestroyTexture(scene_layer);
  scene_layer = SDL_CreateTexture(renderer, SDL_PIXELFORMAT_RGBA32, SDL_TEXTUREACCESS_TARGET, width, height);
  scene_width = width; scene_height = height;
  if (!scene_layer) fprintf(stderr, "offscreen layer: %s\n", SDL_GetError());
  return scene_layer;
}

static void render(SDL_Renderer *renderer) {
  Uint64 frame_time = SDL_GetTicks();
  if (fps_window_start == 0) fps_window_start = frame_time;
  fps_frames++;
  Uint64 elapsed = frame_time - fps_window_start;
  if (elapsed >= 500) {
    fps_value = (float)fps_frames * 1000.0f / (float)elapsed;
    fps_frames = 0;
    fps_window_start = frame_time;
  }
  SDL_Texture *layer = ensure_scene_layer(renderer);
  if (layer) SDL_SetRenderTarget(renderer, layer);
  SDL_SetRenderDrawColor(renderer, clear_r, clear_g, clear_b, clear_a);
  SDL_RenderClear(renderer);
  for (int i=0; i<command_count; i++) {
    Command *c = &commands[i];
    SDL_SetRenderDrawBlendMode(renderer, c->blend);
    SDL_SetRenderDrawColor(renderer, c->r, c->g, c->b, c->a);
    if (c->type == CMD_RECT) {
      draw_rect(renderer, c);
    } else if (c->type == CMD_CIRCLE) draw_circle(renderer, c);
    else if (c->type == CMD_LINE) draw_ribbon_segment(renderer,c->x1,c->y1,c->x2,c->y2,c->width,color(c->r,c->g,c->b,c->a));
    else if (c->type == CMD_POLYLINE && c->count > 1)
      for (int p=1;p<c->count;p++) draw_ribbon_segment(renderer,c->points[p-1].x,c->points[p-1].y,c->points[p].x,c->points[p].y,c->width,color(c->r,c->g,c->b,c->a));
  }
  if (layer) {
    SDL_SetRenderTarget(renderer, NULL);
    SDL_SetTextureBlendMode(layer, SDL_BLENDMODE_NONE);
    SDL_RenderTexture(renderer, layer, NULL, NULL);
  }
  /* The UI is composited after the scene layer, preserving crisp help/status text. */
  if (show_help || SDL_GetTicks() < status_until) {
    SDL_SetRenderDrawColor(renderer, 8, 10, 22, 220);
    SDL_FRect panel = {22, 22, 520, show_help ? 116 : 42};
    SDL_RenderFillRect(renderer, &panel);
    SDL_SetRenderDrawColor(renderer, 205, 224, 255, 255);
    if (show_help) {
      SDL_RenderDebugText(renderer, 38, 38, "Ao controls");
      SDL_RenderDebugText(renderer, 38, 58, "j previous   k next   f fullscreen");
      SDL_RenderDebugText(renderer, 38, 78, "r reload     h help   i FPS   q / Esc quit");
    }
    if (status_text[0]) SDL_RenderDebugText(renderer, 38, show_help ? 108 : 38, status_text);
  }
  if (show_fps) {
    char fps_text[32];
    snprintf(fps_text, sizeof(fps_text), "FPS %.1f", fps_value);
    int width = 0, height = 0;
    SDL_GetRenderOutputSize(renderer, &width, &height);
    SDL_SetRenderDrawColor(renderer, 8, 10, 22, 220);
    SDL_FRect panel = {(float)(width - 118), 22, 96, 42};
    SDL_RenderFillRect(renderer, &panel);
    SDL_SetRenderDrawColor(renderer, 205, 224, 255, 255);
    SDL_RenderDebugText(renderer, (float)(width - 102), 38, fps_text);
  }
  SDL_RenderPresent(renderer);
}

static void parse_line(char *line, SDL_Window *window, SDL_Renderer *renderer, int *present) {
  if (!strncmp(line, "clear ", 6)) { sscanf(line+6, "%hhu %hhu %hhu %hhu", &clear_r,&clear_g,&clear_b,&clear_a); command_count=0; active_blend=SDL_BLENDMODE_BLEND; }
  else if (!strncmp(line, "blend ", 6)) active_blend = !strcmp(line+6,"add") || !strcmp(line+6,"screen") ? SDL_BLENDMODE_ADD : SDL_BLENDMODE_BLEND;
  else if (!strncmp(line, "title ", 6)) SDL_SetWindowTitle(window, line+6);
  else if (!strncmp(line, "help ", 5)) show_help = atoi(line+5) != 0;
  else if (!strncmp(line, "status ", 7)) { snprintf(status_text, sizeof(status_text), "%s", line+7); status_until = SDL_GetTicks() + 3000; }
  else if (!strcmp(line, "present")) *present = 1;
  else if (command_count < MAX_COMMANDS) {
    Command *c = &commands[command_count]; memset(c, 0, sizeof(*c)); c->blend=active_blend;
    if (sscanf(line, "rect %f %f %f %f %hhu %hhu %hhu %hhu %hhu %hhu %hhu %hhu", &c->x1,&c->y1,&c->x2,&c->y2,&c->r,&c->g,&c->b,&c->a,&c->r2,&c->g2,&c->b2,&c->a2) == 12) { c->type=CMD_RECT; command_count++; }
    else if (sscanf(line, "circle %f %f %f %hhu %hhu %hhu %hhu %hhu %hhu %hhu %hhu", &c->x1,&c->y1,&c->radius,&c->r,&c->g,&c->b,&c->a,&c->r2,&c->g2,&c->b2,&c->a2) == 11) { c->type=CMD_CIRCLE; command_count++; }
    else if (sscanf(line, "line %f %f %f %f %f %hhu %hhu %hhu %hhu", &c->x1,&c->y1,&c->x2,&c->y2,&c->width,&c->r,&c->g,&c->b,&c->a) == 9) { c->type=CMD_LINE; command_count++; }
    else if (!strncmp(line, "polyline ", 9)) {
      char *at=line+9, *end; c->type=CMD_POLYLINE; c->count=(int)strtol(at,&end,10); at=end;
      c->width=strtof(at,&end); at=end;
      c->r=(Uint8)strtoul(at,&end,10); at=end; c->g=(Uint8)strtoul(at,&end,10); at=end; c->b=(Uint8)strtoul(at,&end,10); at=end; c->a=(Uint8)strtoul(at,&end,10); at=end;
      if (c->count < 2 || c->count > MAX_POINTS) return;
      for (int i=0;i<c->count;i++) { c->points[i].x=strtof(at,&end); at=end; c->points[i].y=strtof(at,&end); at=end; }
      command_count++;
    }
  }
  (void)renderer;
}

int main(void) {
  if (!SDL_Init(SDL_INIT_VIDEO)) { fprintf(stderr,"SDL init: %s\n",SDL_GetError()); return 1; }
  SDL_Window *window = SDL_CreateWindow("Ao", 1280, 720, SDL_WINDOW_RESIZABLE | SDL_WINDOW_BORDERLESS | SDL_WINDOW_HIGH_PIXEL_DENSITY);
  if (!window) { fprintf(stderr,"window: %s\n",SDL_GetError()); return 1; }
  /* SDL's GPU renderer is explicitly given a Vulkan device; drawing remains a tiny 2D API. */
  SDL_GPUDevice *gpu = SDL_CreateGPUDevice(SDL_GPU_SHADERFORMAT_SPIRV, false, "vulkan");
  SDL_Renderer *renderer = NULL;
  if (gpu) {
    SDL_PropertiesID props = SDL_CreateProperties();
    SDL_SetPointerProperty(props, SDL_PROP_RENDERER_CREATE_WINDOW_POINTER, window);
    SDL_SetPointerProperty(props, SDL_PROP_RENDERER_CREATE_GPU_DEVICE_POINTER, gpu);
    SDL_SetStringProperty(props, SDL_PROP_RENDERER_CREATE_NAME_STRING, "gpu");
    renderer = SDL_CreateRendererWithProperties(props); SDL_DestroyProperties(props);
  }
  if (!renderer) renderer = SDL_CreateRenderer(window, "vulkan,gpu");
  if (!renderer) { fprintf(stderr,"Vulkan renderer: %s\n",SDL_GetError()); SDL_DestroyWindow(window); SDL_Quit(); return 1; }
  fprintf(stderr,"Ao renderer: %s\n", SDL_GetRendererName(renderer));
  SDL_SetRenderVSync(renderer, 1);
  report_size(window);
  int flags = fcntl(STDIN_FILENO, F_GETFL, 0); fcntl(STDIN_FILENO, F_SETFL, flags | O_NONBLOCK);
  char input[65536] = {0}; size_t used=0; int running=1;
  while (running) {
    SDL_Event e;
    while (SDL_PollEvent(&e)) {
      if (e.type == SDL_EVENT_QUIT) running=0;
      if (e.type == SDL_EVENT_WINDOW_RESIZED || e.type == SDL_EVENT_WINDOW_PIXEL_SIZE_CHANGED ||
          e.type == SDL_EVENT_WINDOW_ENTER_FULLSCREEN || e.type == SDL_EVENT_WINDOW_LEAVE_FULLSCREEN) report_size(window);
      if (e.type == SDL_EVENT_KEY_DOWN && !e.key.repeat) {
        SDL_Keycode k=e.key.key;
        if (k == SDLK_J) puts("key j"); else if (k == SDLK_K) puts("key k");
        else if (k == SDLK_H) puts("key h"); else if (k == SDLK_R) puts("key r");
        else if (k == SDLK_I) { show_fps = !show_fps; puts("key i"); }
        else if (k == SDLK_F) { SDL_SetWindowFullscreen(window, !(SDL_GetWindowFlags(window)&SDL_WINDOW_FULLSCREEN)); puts("key f"); }
        else if (k == SDLK_Q) { puts("key q"); running=0; } else if (k == SDLK_ESCAPE) { puts("key escape"); running=0; }
        fflush(stdout);
      }
    }
    char chunk[4096]; ssize_t n=read(STDIN_FILENO,chunk,sizeof(chunk));
    if (n > 0 && used+(size_t)n < sizeof(input)) { memcpy(input+used,chunk,n); used+=n; input[used]=0; }
    else if (n == 0) running = 0; /* The Racket host exited. */
    int present=0; char *start=input, *nl;
    while ((nl=strchr(start,'\n'))) { *nl=0; parse_line(start,window,renderer,&present); start=nl+1; }
    size_t remain=used-(size_t)(start-input); memmove(input,start,remain); used=remain; input[used]=0;
    if (present) render(renderer);
    SDL_Delay(1);
  }
  if (scene_layer) SDL_DestroyTexture(scene_layer);
  SDL_DestroyRenderer(renderer); if (gpu) SDL_DestroyGPUDevice(gpu); SDL_DestroyWindow(window); SDL_Quit(); return 0;
}
