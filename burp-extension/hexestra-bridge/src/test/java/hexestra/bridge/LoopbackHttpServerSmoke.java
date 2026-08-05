package hexestra.bridge;

import java.io.IOException;
import java.net.HttpURLConnection;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;

public final class LoopbackHttpServerSmoke {
    public static void main(String[] args) throws Exception {
        byte[] expectedBody = new byte[] {0, 1, (byte) 255, 7};
        try (LoopbackHttpServer server = new LoopbackHttpServer(0, request -> {
            if ("/health".equals(request.path())) {
                require("GET".equals(request.method()), "GET method was not parsed");
                require("Bearer test-token".equals(request.header("authorization")), "Header lookup is not case insensitive");
                return LoopbackHttpServer.Response.json(200, "{\"ok\":true}");
            }
            if ("/binary".equals(request.path())) {
                require("POST".equals(request.method()), "POST method was not parsed");
                require(Arrays.equals(expectedBody, request.body()), "Binary request body changed");
                return LoopbackHttpServer.Response.json(200, "{\"bytes\":" + request.body().length + "}");
            }
            return LoopbackHttpServer.Response.json(404, "{\"error\":\"Not found\"}");
        })) {
            server.start();
            require(request(server.port(), "GET", "/health", null).equals("{\"ok\":true}"), "Health response changed");
            require(request(server.port(), "POST", "/binary", expectedBody).equals("{\"bytes\":4}"), "Binary response changed");
        }
        try (ServerSocket occupied = new ServerSocket(0, 1, InetAddress.getByName("127.0.0.1"))) {
            int requestedPort = occupied.getLocalPort();
            LoopbackHttpServer.Binding binding = LoopbackHttpServer.bindWithFallback(
                    requestedPort,
                    request -> LoopbackHttpServer.Response.json(200, "{\"fallback\":true}"));
            try (LoopbackHttpServer fallback = binding.server()) {
                require(binding.usedFallback(), "An occupied preferred port did not use the fallback");
                require(binding.requestedPort() == requestedPort, "The requested port was not retained in the binding result");
                require(binding.actualPort() != requestedPort, "The fallback reused the occupied port");
                fallback.start();
                require(request(binding.actualPort(), "GET", "/", null).equals("{\"fallback\":true}"), "Fallback listener did not respond");
            }
        }
        System.out.println("LoopbackHttpServerSmoke PASS");
    }

    private static String request(int port, String method, String path, byte[] body) throws IOException {
        HttpURLConnection connection = (HttpURLConnection) new URL("http://127.0.0.1:" + port + path).openConnection();
        connection.setRequestMethod(method);
        connection.setRequestProperty("Authorization", "Bearer test-token");
        connection.setConnectTimeout(2_000);
        connection.setReadTimeout(2_000);
        if (body != null) {
            connection.setDoOutput(true);
            connection.setFixedLengthStreamingMode(body.length);
            connection.getOutputStream().write(body);
        }
        int status = connection.getResponseCode();
        byte[] response = connection.getInputStream().readAllBytes();
        connection.disconnect();
        require(status == 200, "Unexpected HTTP status " + status);
        return new String(response, StandardCharsets.UTF_8);
    }

    private static void require(boolean condition, String message) {
        if (!condition) throw new IllegalStateException(message);
    }
}
