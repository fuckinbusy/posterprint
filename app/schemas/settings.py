"""Настройки владельца."""

from __future__ import annotations

from pydantic import BaseModel, Field, field_validator

# логотип — картинка в base64, остальные значения — короткие строки; потолок
# общий и с запасом, точный размер логотипа проверяет settings.save
MAX_VALUE_BYTES = 600_000


class SettingsIn(BaseModel):
    values: dict[str, str] = Field(max_length=100)

    @field_validator("values")
    @classmethod
    def _not_huge(cls, values: dict[str, str]) -> dict[str, str]:
        for key, value in values.items():
            if len(value) > MAX_VALUE_BYTES:
                raise ValueError(f"Значение «{key}» слишком велико")
        return values
