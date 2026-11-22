package com.vampn.ssh

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.jcraft.jsch.ChannelExec
import com.jcraft.jsch.JSch
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.util.concurrent.Executors

class NativeVampnSshModule(reactContext: ReactApplicationContext) :
    NativeVampnSshSpec(reactContext) {

  private val executor = Executors.newSingleThreadExecutor()

  override fun exec(requestJson: String, promise: Promise) {
    executor.execute {
      try {
        promise.resolve(runCommands(requestJson))
      } catch (error: Exception) {
        promise.reject("SSH_ERROR", error.message, error)
      }
    }
  }

  private fun runCommands(requestJson: String): String {
    val request = JSONObject(requestJson)
    val host = request.optString("host").trim()
    val port = request.optInt("port", 22).let { if (it > 0) it else 22 }
    val username = request.optString("username").trim()
    val password = request.optString("password")
    val privateKey = request.optString("privateKey").trim()
    val passphrase = request.optString("passphrase")
    val commands = request.optJSONArray("commands") ?: JSONArray()

    if (host.isEmpty() || username.isEmpty()) {
      throw IllegalArgumentException("Host and username are required")
    }
    if (commands.length() == 0) {
      throw IllegalArgumentException("No commands")
    }

    val jsch = JSch()
    if (privateKey.isNotEmpty()) {
      val passBytes = if (passphrase.isEmpty()) null else passphrase.toByteArray(Charsets.UTF_8)
      jsch.addIdentity(
          "vampn",
          privateKey.toByteArray(Charsets.UTF_8),
          null,
          passBytes,
      )
    }

    val session = jsch.getSession(username, host, port)
    if (privateKey.isEmpty()) {
      session.setPassword(password)
    }
    session.setConfig("StrictHostKeyChecking", "no")
    session.connect(15_000)

    val output = StringBuilder()
    var ok = true
    try {
      for (index in 0 until commands.length()) {
        val command = commands.optString(index)
        if (command.isBlank()) {
          continue
        }
        val channel = session.openChannel("exec") as ChannelExec
        channel.setCommand(command)
        val stdout = ByteArrayOutputStream()
        val stderr = ByteArrayOutputStream()
        channel.outputStream = stdout
        channel.setErrStream(stderr)
        channel.connect(15_000)
        val started = System.currentTimeMillis()
        while (!channel.isClosed) {
          if (System.currentTimeMillis() - started > 60_000) {
            channel.disconnect()
            break
          }
          Thread.sleep(50)
        }
        val code = channel.exitStatus
        if (code != 0) {
          ok = false
        }
        output.append("$ ").append(command).append('\n')
        output.append(stdout.toString(Charsets.UTF_8))
        val err = stderr.toString(Charsets.UTF_8)
        if (err.isNotBlank()) {
          output.append(err)
        }
        output.append("exit ").append(code).append('\n')
        channel.disconnect()
      }
    } finally {
      session.disconnect()
    }

    var text = output.toString()
    if (text.length > 4000) {
      text = text.substring(0, 4000) + "\n…"
    }
    return JSONObject().put("ok", ok).put("output", text).toString()
  }

  companion object {
    const val NAME = NativeVampnSshSpec.NAME
  }
}
