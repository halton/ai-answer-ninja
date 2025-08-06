package repository

import "errors"

// Common repository errors
var (
	ErrNotFound      = errors.New("resource not found")
	ErrAlreadyExists = errors.New("resource already exists")
	ErrInvalidInput  = errors.New("invalid input")
	ErrConstraint    = errors.New("constraint violation")
)