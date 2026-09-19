#include <node_api.h>
#include <windows.h>

#include <vector>

namespace {

napi_value ThrowError(napi_env env, const char* message) {
  napi_throw_error(env, nullptr, message);
  return nullptr;
}

napi_value HasWindowsReparsePoint(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value args[1];
  if (napi_get_cb_info(env, info, &argc, args, nullptr, nullptr) != napi_ok || argc != 1) {
    return ThrowError(env, "hasWindowsReparsePoint requires one string path.");
  }

  napi_valuetype type;
  if (napi_typeof(env, args[0], &type) != napi_ok || type != napi_string) {
    return ThrowError(env, "hasWindowsReparsePoint requires one string path.");
  }

  size_t length = 0;
  if (napi_get_value_string_utf16(env, args[0], nullptr, 0, &length) != napi_ok) {
    return ThrowError(env, "Could not convert path to UTF-16.");
  }
  std::vector<char16_t> path(length + 1);
  if (napi_get_value_string_utf16(env, args[0], path.data(), path.size(), &length) != napi_ok) {
    return ThrowError(env, "Could not convert path to UTF-16.");
  }

  const DWORD attributes = GetFileAttributesW(reinterpret_cast<LPCWSTR>(path.data()));
  if (attributes == INVALID_FILE_ATTRIBUTES) {
    return ThrowError(env, "GetFileAttributesW failed");
  }

  napi_value result;
  if (napi_get_boolean(env, (attributes & FILE_ATTRIBUTE_REPARSE_POINT) != 0, &result) != napi_ok) {
    return ThrowError(env, "Could not create reparse-point result.");
  }
  return result;
}

napi_value Init(napi_env env, napi_value exports) {
  napi_property_descriptor descriptor = {
      "hasWindowsReparsePoint", nullptr, HasWindowsReparsePoint, nullptr, nullptr, nullptr, napi_default, nullptr};
  if (napi_define_properties(env, exports, 1, &descriptor) != napi_ok) {
    return nullptr;
  }
  return exports;
}

}  // namespace

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
