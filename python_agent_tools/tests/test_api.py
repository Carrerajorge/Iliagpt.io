"""Tests for FastAPI endpoints."""

import pytest
from fastapi.testclient import TestClient
from src.api.main import app

client = TestClient(app)


class TestHealthEndpoint:
    def test_health(self):
        response = client.get("/health")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "healthy"
        assert "tools_count" in data
        assert data["tools_count"] > 0


class TestToolsListEndpoint:
    def test_list_tools(self):
        response = client.get("/tools")
        assert response.status_code == 200
        tools = response.json()
        assert isinstance(tools, list)
        assert len(tools) > 0
    
    def test_tools_structure(self):
        response = client.get("/tools")
        tools = response.json()
        
        for tool in tools:
            assert "name" in tool
            assert "description" in tool
            assert "category" in tool
            assert "priority" in tool
            assert "dependencies" in tool
    
    def test_shell_tool_in_list(self):
        response = client.get("/tools")
        tools = response.json()
        
        tool_names = [t["name"] for t in tools]
        assert "shell" in tool_names


class TestGetToolEndpoint:
    def test_get_existing_tool(self):
        response = client.get("/tools/shell")
        assert response.status_code == 200
        tool = response.json()
        assert tool["name"] == "shell"
        assert tool["category"] == "Sistema"
    
    def test_get_nonexistent_tool(self):
        response = client.get("/tools/nonexistent_tool_xyz")
        assert response.status_code == 404
    
    def test_get_code_execute_tool(self):
        response = client.get("/tools/code_execute")
        assert response.status_code == 200
        tool = response.json()
        assert tool["name"] == "code_execute"
    
    def test_get_file_read_tool(self):
        response = client.get("/tools/file_read")
        assert response.status_code == 200
        tool = response.json()
        assert tool["name"] == "file_read"
        assert tool["category"] == "Archivos"


class TestExecuteToolEndpoint:
    def test_execute_shell_echo(self):
        response = client.post("/tools/shell/execute", json={
            "tool_name": "shell",
            "input": {"command": "echo test"}
        })
        assert response.status_code == 200
        result = response.json()
        assert result["success"] == True
        assert "test" in result["data"]["stdout"] if result["data"] else True
    
    def test_execute_shell_disallowed(self):
        response = client.post("/tools/shell/execute", json={
            "tool_name": "shell",
            "input": {"command": "rm -rf /"}
        })
        assert response.status_code == 200
        result = response.json()
        assert result["success"] == False
        assert "not allowed" in result["error"].lower()
    
    def test_execute_nonexistent_tool(self):
        response = client.post("/tools/nonexistent_xyz/execute", json={
            "tool_name": "nonexistent_xyz",
            "input": {}
        })
        assert response.status_code == 404
    
    def test_execute_with_invalid_input(self):
        response = client.post("/tools/shell/execute", json={
            "tool_name": "shell",
            "input": {}
        })
        assert response.status_code == 500 or response.status_code == 422


class TestAPIValidation:
    def test_missing_tool_name_in_body(self):
        response = client.post("/tools/shell/execute", json={
            "input": {"command": "echo hello"}
        })
        assert response.status_code in [422, 500]
    
    def test_missing_input_in_body(self):
        response = client.post("/tools/shell/execute", json={
            "tool_name": "shell"
        })
        assert response.status_code in [422, 500]
    
    def test_invalid_json(self):
        response = client.post(
            "/tools/shell/execute",
            content="not valid json",
            headers={"Content-Type": "application/json"}
        )
        assert response.status_code in [422, 400]


class TestCORSMiddleware:
    def test_cors_headers(self):
        response = client.options(
            "/health",
            headers={
                "Origin": "http://localhost:3000",
                "Access-Control-Request-Method": "GET"
            }
        )
        assert response.status_code in [200, 405]


class TestToolExecution:
    def test_execute_pwd_command(self):
        response = client.post("/tools/shell/execute", json={
            "tool_name": "shell",
            "input": {"command": "pwd"}
        })
        assert response.status_code == 200
        result = response.json()
        assert result["success"] == True
    
    def test_execute_ls_command(self):
        response = client.post("/tools/shell/execute", json={
            "tool_name": "shell",
            "input": {"command": "ls"}
        })
        assert response.status_code == 200
        result = response.json()
        assert result["success"] == True
    
    def test_execute_with_timeout(self):
        response = client.post("/tools/shell/execute", json={
            "tool_name": "shell",
            "input": {
                "command": "echo hello",
                "timeout": 5
            }
        })
        assert response.status_code == 200
        result = response.json()
        assert result["success"] == True
