"""Data transformation tool for JSON, CSV, and XML conversions."""

from typing import Optional, List, Dict, Any, Literal, Union
from pydantic import BaseModel, Field
from .base import BaseTool, ToolCategory, Priority, ToolInput, ToolOutput
from ..core.registry import ToolRegistry
import json
import csv
import io
import re
from xml.etree.ElementTree import Element, SubElement, tostring
from defusedxml.ElementTree import fromstring, ParseError
from defusedxml import minidom


class TransformResult(BaseModel):
    """Result of data transformation."""
    output_format: str
    data: str
    record_count: int
    schema_info: Optional[Dict[str, Any]] = None


class DataTransformInput(ToolInput):
    """Input for data transformation tool."""
    data: str = Field(..., description="Input data as string")
    input_format: Literal["json", "csv", "xml"] = Field(..., description="Input data format")
    output_format: Literal["json", "csv", "xml"] = Field(..., description="Output data format")
    json_path: Optional[str] = Field(None, description="JSONPath expression to extract data")
    csv_delimiter: str = Field(",", max_length=1, description="CSV delimiter character")
    xml_root: str = Field("root", description="Root element name for XML output")
    xml_item: str = Field("item", description="Item element name for XML output")
    pretty_print: bool = Field(True, description="Format output with indentation")
    validate_schema: bool = Field(False, description="Validate against inferred schema")
    flatten: bool = Field(False, description="Flatten nested structures")
    field_mapping: Dict[str, str] = Field(default={}, description="Field name mapping")


class DataTransformOutput(ToolOutput):
    """Output from data transformation tool."""
    data: Optional[TransformResult] = None


def flatten_dict(d: Dict[str, Any], parent_key: str = '', sep: str = '_') -> Dict[str, Any]:
    """Flatten a nested dictionary."""
    items: List[tuple] = []
    for k, v in d.items():
        new_key = f"{parent_key}{sep}{k}" if parent_key else k
        if isinstance(v, dict):
            items.extend(flatten_dict(v, new_key, sep).items())
        elif isinstance(v, list):
            for i, item in enumerate(v):
                if isinstance(item, dict):
                    items.extend(flatten_dict(item, f"{new_key}{sep}{i}", sep).items())
                else:
                    items.append((f"{new_key}{sep}{i}", item))
        else:
            items.append((new_key, v))
    return dict(items)


def apply_field_mapping(record: Dict[str, Any], mapping: Dict[str, str]) -> Dict[str, Any]:
    """Apply field name mapping to a record."""
    if not mapping:
        return record
    return {mapping.get(k, k): v for k, v in record.items()}


def infer_schema(records: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Infer schema from a list of records."""
    if not records:
        return {"fields": [], "record_count": 0}
    
    field_types: Dict[str, set] = {}
    for record in records:
        for key, value in record.items():
            if key not in field_types:
                field_types[key] = set()
            field_types[key].add(type(value).__name__)
    
    fields = []
    for key, types in field_types.items():
        fields.append({
            "name": key,
            "types": list(types),
            "nullable": "NoneType" in types
        })
    
    return {
        "fields": fields,
        "record_count": len(records)
    }


def parse_json(data: str, json_path: Optional[str] = None) -> List[Dict[str, Any]]:
    """Parse JSON data and optionally extract with JSONPath."""
    parsed = json.loads(data)
    
    if isinstance(parsed, dict):
        if json_path and json_path in parsed:
            parsed = parsed[json_path]
        elif not isinstance(parsed, list):
            parsed = [parsed]
    
    if isinstance(parsed, list):
        records = []
        for item in parsed:
            if isinstance(item, dict):
                records.append(item)
            else:
                records.append({"value": item})
        return records
    
    return [{"value": parsed}]


def parse_csv(data: str, delimiter: str = ",") -> List[Dict[str, Any]]:
    """Parse CSV data to list of dictionaries."""
    reader = csv.DictReader(io.StringIO(data), delimiter=delimiter)
    return list(reader)


def parse_xml(data: str) -> List[Dict[str, Any]]:
    """Parse XML data to list of dictionaries."""
    root = fromstring(data)
    records = []
    
    for child in root:
        record = {}
        for elem in child:
            record[elem.tag] = elem.text or ""
        if not record:
            record = {"value": child.text or "", "tag": child.tag}
        records.append(record)
    
    if not records and root.text:
        records = [{"value": root.text, "tag": root.tag}]
    
    return records


def to_json(records: List[Dict[str, Any]], pretty: bool = True) -> str:
    """Convert records to JSON string."""
    if pretty:
        return json.dumps(records, indent=2, ensure_ascii=False, default=str)
    return json.dumps(records, ensure_ascii=False, default=str)


def to_csv(records: List[Dict[str, Any]], delimiter: str = ",") -> str:
    """Convert records to CSV string."""
    if not records:
        return ""
    
    all_keys = set()
    for record in records:
        all_keys.update(record.keys())
    fieldnames = sorted(all_keys)
    
    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=fieldnames, delimiter=delimiter)
    writer.writeheader()
    for record in records:
        writer.writerow({k: str(v) if v is not None else "" for k, v in record.items()})
    
    return output.getvalue()


def to_xml(records: List[Dict[str, Any]], root_name: str = "root", item_name: str = "item", pretty: bool = True) -> str:
    """Convert records to XML string."""
    root = Element(root_name)
    
    for record in records:
        item = SubElement(root, item_name)
        for key, value in record.items():
            safe_key = re.sub(r'[^\w]', '_', str(key))
            if not safe_key[0].isalpha() and safe_key[0] != '_':
                safe_key = '_' + safe_key
            elem = SubElement(item, safe_key)
            elem.text = str(value) if value is not None else ""
    
    if pretty:
        xml_str = tostring(root, encoding='unicode')
        dom = minidom.parseString(xml_str)
        return dom.toprettyxml(indent="  ")
    
    return tostring(root, encoding='unicode')


@ToolRegistry.register
class DataTransformTool(BaseTool[DataTransformInput, DataTransformOutput]):
    """Tool for transforming data between JSON, CSV, and XML formats."""
    
    name = "data_transform"
    description = "Transforms data between JSON, CSV, and XML formats with validation and schema conversion"
    category = ToolCategory.DATA
    priority = Priority.MEDIUM
    dependencies = []
    
    async def execute(self, input: DataTransformInput) -> DataTransformOutput:
        """Execute data transformation."""
        self.logger.info(
            "data_transform_start",
            input_format=input.input_format,
            output_format=input.output_format
        )
        
        try:
            if input.input_format == "json":
                records = parse_json(input.data, input.json_path)
            elif input.input_format == "csv":
                records = parse_csv(input.data, input.csv_delimiter)
            elif input.input_format == "xml":
                records = parse_xml(input.data)
            else:
                return DataTransformOutput(
                    success=False,
                    error=f"Unsupported input format: {input.input_format}"
                )
            
            if input.flatten:
                records = [flatten_dict(r) for r in records]
            
            if input.field_mapping:
                records = [apply_field_mapping(r, input.field_mapping) for r in records]
            
            schema_info = None
            if input.validate_schema:
                schema_info = infer_schema(records)
            
            if input.output_format == "json":
                output_data = to_json(records, input.pretty_print)
            elif input.output_format == "csv":
                output_data = to_csv(records, input.csv_delimiter)
            elif input.output_format == "xml":
                output_data = to_xml(records, input.xml_root, input.xml_item, input.pretty_print)
            else:
                return DataTransformOutput(
                    success=False,
                    error=f"Unsupported output format: {input.output_format}"
                )
            
            result = TransformResult(
                output_format=input.output_format,
                data=output_data,
                record_count=len(records),
                schema_info=schema_info
            )
            
            self.logger.info(
                "data_transform_complete",
                input_format=input.input_format,
                output_format=input.output_format,
                record_count=len(records)
            )
            
            return DataTransformOutput(
                success=True,
                data=result,
                metadata={
                    "input_format": input.input_format,
                    "output_format": input.output_format,
                    "record_count": len(records)
                }
            )
            
        except json.JSONDecodeError as e:
            return DataTransformOutput(
                success=False,
                error=f"JSON parsing error: {str(e)}"
            )
        except ParseError as e:
            return DataTransformOutput(
                success=False,
                error=f"XML parsing error: {str(e)}"
            )
        except Exception as e:
            self.logger.error("data_transform_error", error=str(e))
            return DataTransformOutput(
                success=False,
                error=f"Transformation failed: {str(e)}"
            )


@ToolRegistry.register
class DataValidateTool(BaseTool[DataTransformInput, DataTransformOutput]):
    """Tool for validating data structure and schema."""
    
    name = "data_validate"
    description = "Validates data structure and infers schema from JSON, CSV, or XML data"
    category = ToolCategory.DATA
    priority = Priority.LOW
    dependencies = []
    
    async def execute(self, input: DataTransformInput) -> DataTransformOutput:
        """Execute data validation."""
        self.logger.info("data_validate_start", format=input.input_format)
        
        try:
            if input.input_format == "json":
                records = parse_json(input.data, input.json_path)
            elif input.input_format == "csv":
                records = parse_csv(input.data, input.csv_delimiter)
            elif input.input_format == "xml":
                records = parse_xml(input.data)
            else:
                return DataTransformOutput(
                    success=False,
                    error=f"Unsupported format: {input.input_format}"
                )
            
            schema_info = infer_schema(records)
            
            result = TransformResult(
                output_format="schema",
                data=json.dumps(schema_info, indent=2),
                record_count=len(records),
                schema_info=schema_info
            )
            
            return DataTransformOutput(
                success=True,
                data=result,
                metadata={"format": input.input_format, "valid": True}
            )
            
        except Exception as e:
            return DataTransformOutput(
                success=False,
                error=f"Validation failed: {str(e)}",
                metadata={"valid": False}
            )
