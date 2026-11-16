{
  "targets": [
    {
      "target_name": "executor_lock",
      "sources": [
        "executor_lock.cc"
      ],
      "defines": [
        "NAPI_VERSION=8"
      ],
      "conditions": [
        [
          "OS=='win'",
          {
            "msvs_settings": {
              "VCCLCompilerTool": {
                "AdditionalOptions": [
                  "/std:c++17"
                ]
              }
            }
          }
        ],
        [
          "OS!='win'",
          {
            "cflags_cc": [
              "-std=c++17"
            ]
          }
        ]
      ]
    },
    {
      "target_name": "executor_lock_test",
      "sources": [
        "executor_lock.cc"
      ],
      "defines": [
        "NAPI_VERSION=8",
        "NODUS_LOCK_TESTING=1"
      ],
      "conditions": [
        [
          "OS=='win'",
          {
            "msvs_settings": {
              "VCCLCompilerTool": {
                "AdditionalOptions": [
                  "/std:c++17"
                ]
              }
            }
          }
        ],
        [
          "OS!='win'",
          {
            "cflags_cc": [
              "-std=c++17"
            ]
          }
        ]
      ]
    }
  ]
}
