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
typedef struct { CommandType type; float x1,y1,x2,y2,radius,width; Uint8 r,g,b,a; int count; SDL_FPoint points[MAX_POINTS]; } Command;
static Command commands[MAX_COMMANDS];
static int command_count = 0;
static Uint8 clear_r = 2, clear_g = 2, clear_b = 8, clear_a = 255;
static bool show_help = false;
static char status_text[384] = {0};
static Uint64 status_until = 0;

static void report_size(SDL_Window *window) {
  int width = 0, height = 0;
  if (SDL_GetWindowSizeInPixels(window, &width, &height)) {
    printf("size %d %d\n", width, height);
    fflush(stdout);
  }
}

static void draw_circle(SDL_Renderer *renderer, const Command *c) {
  SDL_SetRenderDrawColor(renderer, c->r, c->g, c->b, c->a);
  int steps = 42;
  for (int i = 0; i < steps; i++) {
    float a = (float)i * 2.0f * (float)M_PI / steps;
    float b = (float)(i + 1) * 2.0f * (float)M_PI / steps;
    SDL_RenderLine(renderer, c->x1 + cosf(a)*c->radius, c->y1 + sinf(a)*c->radius,
                   c->x1 + cosf(b)*c->radius, c->y1 + sinf(b)*c->radius);
  }
}

static void render(SDL_Renderer *renderer) {
  SDL_SetRenderDrawBlendMode(renderer, SDL_BLENDMODE_BLEND);
  SDL_SetRenderDrawColor(renderer, clear_r, clear_g, clear_b, clear_a);
  SDL_RenderClear(renderer);
  for (int i=0; i<command_count; i++) {
    Command *c = &commands[i];
    SDL_SetRenderDrawColor(renderer, c->r, c->g, c->b, c->a);
    if (c->type == CMD_RECT) {
      SDL_FRect rect = {c->x1,c->y1,c->x2,c->y2}; SDL_RenderFillRect(renderer, &rect);
    } else if (c->type == CMD_CIRCLE) draw_circle(renderer, c);
    else if (c->type == CMD_LINE) {
      /* SDL's 2D primitive is one pixel; layered lines give useful visual weight. */
      int layers = (int)fmaxf(1, fminf(18, c->width));
      for (int j=0;j<layers;j++) SDL_RenderLine(renderer, c->x1, c->y1+j-layers/2.0f, c->x2, c->y2+j-layers/2.0f);
    } else if (c->type == CMD_POLYLINE && c->count > 1) {
      int layers = (int)fmaxf(1, fminf(18, c->width));
      for (int j=0;j<layers;j++) {
        SDL_FPoint shifted[MAX_POINTS];
        for (int p=0;p<c->count;p++) { shifted[p] = c->points[p]; shifted[p].y += j-layers/2.0f; }
        SDL_RenderLines(renderer, shifted, c->count);
      }
    }
  }
  if (show_help || SDL_GetTicks() < status_until) {
    SDL_SetRenderDrawColor(renderer, 8, 10, 22, 220);
    SDL_FRect panel = {22, 22, 520, show_help ? 116 : 42};
    SDL_RenderFillRect(renderer, &panel);
    SDL_SetRenderDrawColor(renderer, 205, 224, 255, 255);
    if (show_help) {
      SDL_RenderDebugText(renderer, 38, 38, "Ao controls");
      SDL_RenderDebugText(renderer, 38, 58, "j previous   k next   f fullscreen");
      SDL_RenderDebugText(renderer, 38, 78, "r reload     h help   q / Esc quit");
    }
    if (status_text[0]) SDL_RenderDebugText(renderer, 38, show_help ? 108 : 38, status_text);
  }
  SDL_RenderPresent(renderer);
}

static void parse_line(char *line, SDL_Window *window, SDL_Renderer *renderer, int *present) {
  if (!strncmp(line, "clear ", 6)) { sscanf(line+6, "%hhu %hhu %hhu %hhu", &clear_r,&clear_g,&clear_b,&clear_a); command_count=0; }
  else if (!strncmp(line, "title ", 6)) SDL_SetWindowTitle(window, line+6);
  else if (!strncmp(line, "help ", 5)) show_help = atoi(line+5) != 0;
  else if (!strncmp(line, "status ", 7)) { snprintf(status_text, sizeof(status_text), "%s", line+7); status_until = SDL_GetTicks() + 3000; }
  else if (!strcmp(line, "present")) *present = 1;
  else if (command_count < MAX_COMMANDS) {
    Command *c = &commands[command_count]; memset(c, 0, sizeof(*c));
    if (sscanf(line, "rect %f %f %f %f %hhu %hhu %hhu %hhu", &c->x1,&c->y1,&c->x2,&c->y2,&c->r,&c->g,&c->b,&c->a) == 8) { c->type=CMD_RECT; command_count++; }
    else if (sscanf(line, "circle %f %f %f %hhu %hhu %hhu %hhu", &c->x1,&c->y1,&c->radius,&c->r,&c->g,&c->b,&c->a) == 7) { c->type=CMD_CIRCLE; command_count++; }
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
  SDL_Window *window = SDL_CreateWindow("Ao", 1280, 720, SDL_WINDOW_RESIZABLE | SDL_WINDOW_HIGH_PIXEL_DENSITY);
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
  SDL_DestroyRenderer(renderer); if (gpu) SDL_DestroyGPUDevice(gpu); SDL_DestroyWindow(window); SDL_Quit(); return 0;
}
