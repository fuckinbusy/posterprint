"""Схемы запросов и ответов API. Импортируются отсюда: `from app.schemas import OrderOut`."""

from __future__ import annotations

from app.schemas.auth import EmployeeLogin, LoginRequest, LoginResponse
from app.schemas.clients import ClientOut, ClientUpdate, MergeIn
from app.schemas.devices import DeviceOut, DeviceUpdate
from app.schemas.employees import EmployeeCreate, EmployeeOut, EmployeeUpdate
from app.schemas.mail import ReplyIn, SeenIn, SendIn
from app.schemas.orders import (
    EstimateLine,
    EstimateRequest,
    EstimateResponse,
    EventOut,
    ExtraIn,
    ExtraOut,
    NoteCreate,
    OrderBase,
    OrderCreate,
    OrderOut,
    OrderUpdate,
    StatusUpdate,
)
from app.schemas.prices import GroupIn, MoveIn, PriceItemCreate, PriceItemOut, PriceItemUpdate
from app.schemas.settings import SettingsIn
from app.schemas.templates import FieldIn, FieldOut, PreviewIn, TemplateIn, TemplateOut

__all__ = [
    "ClientOut",
    "ClientUpdate",
    "DeviceOut",
    "DeviceUpdate",
    "EmployeeCreate",
    "EmployeeLogin",
    "EmployeeOut",
    "EmployeeUpdate",
    "EstimateLine",
    "EstimateRequest",
    "EstimateResponse",
    "EventOut",
    "ExtraIn",
    "ExtraOut",
    "FieldIn",
    "FieldOut",
    "GroupIn",
    "LoginRequest",
    "LoginResponse",
    "MergeIn",
    "MoveIn",
    "NoteCreate",
    "OrderBase",
    "OrderCreate",
    "OrderOut",
    "OrderUpdate",
    "PreviewIn",
    "PriceItemCreate",
    "PriceItemOut",
    "PriceItemUpdate",
    "ReplyIn",
    "SeenIn",
    "SendIn",
    "SettingsIn",
    "StatusUpdate",
    "TemplateIn",
    "TemplateOut",
]
